## Context

Ver `proposal.md` — Why. Estado atual relevante:

- `whatsapp-connectivity` já recebe, valida (assinatura HMAC) e normaliza eventos de webhook. `HandleInboundMessageUseCase` filtra mensagens de texto, monta o VO `InboundMessage` e só loga. A rota do webhook despacha o processamento de forma fire-and-forget e responde 200 imediatamente.
- Padrão de projeto estabelecido: fatia vertical por capability (`src/<capability>/{domain,application,infrastructure}`), ports em `application/ports/`, VOs com schema zod e factory `create`, validação de ambiente fail-fast com zod, composition root manual em `main.ts`, sem container de DI, Vitest, dependências mínimas.
- A change `add-session-text-messaging` entrega `SendTextMessageUseCase` + `WhatsAppGatewayPort.sendTextMessage` — pré-requisito arquivado antes desta.
- Skill `claude-api`: modelos atuais não aceitam prefill de assistant; saída estruturada é feita via `output_config.format` / `messages.parse()`; default sugerido do projeto fixado em `claude-sonnet-5`.

## Goals / Non-Goals

**Goals:**

- Isolar toda a lógica de raciocínio, histórico e decisão de resposta na nova fatia `conversation-engine`, sem que `whatsapp-connectivity` conheça o motor.
- Manter o cliente LLM atrás de uma abstração fina e agnóstica, trocável na composição.
- Entregar coalescing de rajada com split inteligente de respostas e recuperação de pendências no boot.

**Non-Goals:**

- Sumarização/compactação de histórico longo além do corte por número de turnos.
- Painel/CLI para limpar a marcação "aguardando humano" — feito manualmente editando o arquivo da conversa por enquanto.
- Segurança para múltiplos processos/instâncias (serialização por lead e arquivos JSON assumem processo único).
- Registro dos disparos de template outbound de abertura (limitação já declarada na proposal).

## Decisions

### Fatia vertical nova `src/conversation-engine/{domain,application,infrastructure}`

Segue o mesmo padrão de `whatsapp-connectivity`. Conceitos: `Conversation` (agregado), `ConversationTurn`, `BotDecision` (VO), `ReplyStrategy` (domain service) no domínio; ports e `GenerateReplyUseCase` na aplicação; adapters (Anthropic, persistência em arquivo, coordenador de lote, envio, varredura) na infraestrutura.

### Hand-off inbound via port em `whatsapp-connectivity`, com DTO primitivo

`whatsapp-connectivity/application/ports/inbound-message.port.ts` define `InboundMessagePort` com `receive(message: InboundMessageDto): void`, onde `InboundMessageDto = { from, messageId, text, timestamp }` (primitivos, sem VO). `HandleInboundMessageUseCase` recebe o port por construtor e chama `receive(...)` após logar. O adapter que implementa o port vive no `conversation-engine` (o coordenador de lote).

Alternativas consideradas: a rota do webhook chamando um use case do motor diretamente (acopla infraestrutura de um slice à aplicação de outro); barramento de eventos in-process (infra desproporcional para um único consumidor). DTO em vez do VO `InboundMessage` evita o motor depender do domínio de `whatsapp-connectivity`.

### `LlmClientPort` fino e agnóstico

`generate(request: LlmRequest): Promise<LlmResponse>`. `LlmRequest` carrega `system`, `messages` (lista de `{ role, content }`), `model`, `maxTokens` e `responseSchema?` (JSON Schema para saída estruturada). `LlmResponse` carrega o texto/estrutura crua. Nenhum tipo do `@anthropic-ai/sdk` cruza o port.

O adapter `AnthropicLlmClient` usa `@anthropic-ai/sdk` com `output_config: { format: {...} }` a partir do `responseSchema` (prefill foi removido nos modelos atuais). O prompt de negócio não fica no adapter — é montado pelo `ReplyStrategy`.

### Prompt predefinido em arquivo `.md`, injetado como string

`src/conversation-engine/domain/reply-strategy.prompt.md` contém o prompt de prospecção (extenso, cobrindo múltiplos cenários e o contrato de saída). O composition root (`main.ts`) lê o arquivo e injeta o conteúdo no construtor de `ReplyStrategy`. O domínio não faz `fs`. Resolução de caminho relativo ao módulo via `import.meta.url` no `main.ts` (ESM — sem `__dirname`).

### `ReplyStrategy` monta o request; `GenerateReplyUseCase` valida a saída

`ReplyStrategy.buildRequest(conversation, newMessages): LlmRequest` compõe system prompt + histórico recente (até `CONVERSATION_HISTORY_TURNS`) + as mensagens novas do lote, e expõe o `responseSchema` correspondente ao `BotDecision`. O `GenerateReplyUseCase` valida `LlmResponse` contra o schema zod de `BotDecision` (`BotDecision.create`); saída que não adere = falha de interpretação → retry 1x → registro de erro sem resposta.

### Coalescing: `InboundBatchCoordinator` na infraestrutura do motor

Implementa `InboundMessagePort`. Por lead, mantém: (i) persistência imediata do inbound na `Conversation` marcando o turno como "pendente de decisão"; (ii) buffer de identificadores de mensagem; (iii) `setTimeout` de janela fixa a partir da primeira mensagem pendente (`CONVERSATION_BATCH_WINDOW_MS`); (iv) fila serial por lead. Ao fechar a janela: drena o buffer e chama `GenerateReplyUseCase.execute(leadPhone, messageIds)`. Se a conversa estiver "aguardando humano", persiste o inbound e não agenda processamento. Rajadas que chegam durante o processamento entram em nova janela, enfileirada atrás da atual.

A política de "uma ou várias respostas" NÃO é do coordenador — é do prompt + `BotDecision.replyMessages`.

### Persistência: um arquivo JSON por conversa, escrita atômica

`FileConversationRepository` grava `${CONVERSATIONS_DIR}/<leadPhone>.json` (telefone normalizado para E.164). Escrita atômica: arquivo temporário + `rename`. A serialização por lead do coordenador garante que `load → mutação → save` não intercale para o mesmo lead; leads distintos são independentes. `findConversationsWithPendingInbound()` varre o diretório para a rotina de boot.

### Varredura de boot

`main.ts`, antes de `listen`, chama um serviço que usa `findConversationsWithPendingInbound()`. Para cada lead: se o turno pendente mais recente for mais novo que `BOOT_SWEEP_MAX_AGE_MS` (default 3600000), reenfileira no coordenador; senão marca os turnos pendentes como abandonados e `logger.warn`.

### `handoffToHuman` — opção (a)

As `replyMessages` do turno são enviadas normalmente; a `Conversation` recebe a marcação `awaitingHuman`; `logger.warn`. Enquanto a marcação estiver ativa, o coordenador registra inbounds mas não agenda processamento. Não há reabertura automática — a marcação é removida manualmente (editando o arquivo). `endConversation`, por contraste, reabre no próximo inbound.

### Config própria da fatia

`src/conversation-engine/infrastructure/config/env.ts` com schema zod próprio; `main.ts` chama os dois loaders (`whatsapp-connectivity` e `conversation-engine`). Variáveis: `ANTHROPIC_API_KEY` (obrigatória), `LLM_MODEL` (default `claude-sonnet-5`), `CONVERSATION_BATCH_WINDOW_MS` (default 8000), `CONVERSATION_HISTORY_TURNS` (default 20), `CONVERSATIONS_DIR` (default `./data/conversations`), `BOOT_SWEEP_MAX_AGE_MS` (default 3600000).

### Envio via `ReplySenderPort`

`conversation-engine/application/ports/reply-sender.port.ts` — `send(to: string, body: string): Promise<void>`. Adapter na infra do motor embrulha `SendTextMessageUseCase` da change `add-session-text-messaging`. Retry único por mensagem; falha após retry → `logger.error` e segue o lote.

### Parâmetros da chamada Anthropic

`max_tokens` moderado (~2000 — respostas de conversa são curtas), sem `output_config.effort` explícito (default), sem streaming (saída pequena). `messages.parse()` com o schema quando disponível; caso contrário `messages.create` + `output_config.format` + parse manual contra o schema zod.

## Risks / Trade-offs

- **Latência percebida pelo lead**: janela de 8s + chamada ao LLM + envios sequenciais podem somar 15–25s. → Janela e modelo são configuráveis; aceitável para prospecção (não é atendimento em tempo real).
- **Custo por mensagem cresce com o histórico**: prompt aumenta a cada turno. → Corte de 20 turnos; prompt fixo permite prompt caching numa change futura.
- **Buffer de coalescing em memória**: restart no meio da janela é coberto pela varredura de boot, mas um crash entre a chegada do webhook e a primeira escrita perde a mensagem. → Aceito no POC; janela de exposição é pequena.
- **LLM ignora o schema apesar de `output_config.format`**: lead pode ficar sem resposta. → Tratado como falha de interpretação com retry e log de erro para observabilidade.
- **Processo único assumido**: serialização por lead em memória e arquivos JSON não são seguros para múltiplas instâncias. → Fora de escopo; migрar para store transacional quando escalar.
- **`CONVERSATIONS_DIR` commitado por engano**: dados de conversa no git. → Adicionar `data/` ao `.gitignore` (tarefa explícita).
- **Primeira resposta não vê o template de abertura**: já declarado na proposal; o prompt predefinido carrega contexto do produto suficiente para responder coerente.

## Open Questions

- Estratégia de sumarização/compactação para históricos muito longos (além do corte por turnos) — não afeta specs nem o desenho atual.
- Observabilidade/alerta em falhas de LLM e de envio além de log — depende de infra de observabilidade futura.
- Fluxo operacional para limpar a marcação `awaitingHuman` (painel/CLI) — depende de ferramentas de operação futuras.
