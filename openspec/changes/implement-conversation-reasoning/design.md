## Context

See proposal.md - Why. Hoje `WhatsAppSession` ([src/whatsapp/session.ts](../../../src/whatsapp/session.ts)) só consome `messages.upsert` internamente para marcar mensagens como lidas — nenhuma mensagem recebida chega à aplicação. Já existe um pipeline de envio testado (`SendQueue` + `VolumeGate[]` — `PerSessionWarmupGate`, `DailyVolumeLimiter`) que aplica throttling/anti-ban antes de qualquer envio. `src/index.ts` é hoje um CLI manual, sem orquestração de conversa. Convenções já estabelecidas no projeto: pastas por feature técnica (`whatsapp/`, `warmup/`, `outbound/`), interfaces estruturais enxutas (sem framework de DI), persistência em arquivo local sob `.baileys_auth/` (aceito como limitação single-process, já documentada no change anterior).

## Goals / Non-Goals

**Goals:**
- Entender mensagens 1:1 recebidas via LLM e gerar respostas contextuais, sem acoplar o restante da aplicação a um provedor de LLM específico.
- Manter histórico de conversa por lead, persistente entre reinícios, para que cada resposta considere o contexto acumulado.
- Classificar a intenção do lead (RF-04) na mesma chamada que gera a resposta.
- Entregar as respostas automáticas pelo pipeline de envio já existente (`SendQueue` + gates), sem duplicar lógica de throttling.
- Tornar system prompt e modelo configuráveis externamente, sem exigir alteração de código para ajustá-los.

**Non-Goals:**
- RF-05 (handoff para humano/SDR) — nenhuma notificação ou sinalização é disparada a partir da intenção classificada; fica para um change futuro.
- RF-07 (bloqueio automático por opt-out) — a intenção `Opt-out` é apenas classificada e persistida nesta versão; nenhum comportamento de envio muda em função dela.
- RF-01/RF-02 (importação de leads, campanhas) — como não existem ainda, o gatilho de raciocínio é qualquer mensagem 1:1 recebida numa sessão pareada, não um conjunto de leads conhecidos.
- Persistência multi-processo/distribuída — mesma suposição single-process já aceita por `WarmupTracker`/`DailyVolumeLimiter`.
- Política de retry/backoff para falhas de chamada à LLM ou de envio — segue o mesmo padrão já existente de logar e seguir adiante.

## Decisions

### Decision: `ReasoningRepository` retorna resultado estruturado, não só texto
```
interface ReasoningRepository {
  reason(input: ReasoningInput): Promise<ReasoningResult>
}
interface ReasoningResult {
  replyText: string
  intent: 'interested' | 'not_interested' | 'question' | 'opt_out'
}
```
Uma única chamada resolve RF-03 e RF-04 juntos — evita duas idas à API (latência/custo) para algo que é naturalmente uma saída conjunta do mesmo raciocínio. A implementação Claude usa tool use / structured output da API para obter `intent` como enum confiável, em vez de parsear texto livre.

**Alternativa considerada**: duas chamadas separadas (uma para gerar a resposta, outra para classificar). Rejeitada — dobra a latência (relevante dado o RNF de resposta em até 5s) e o custo, sem ganho claro de qualidade.

### Decision: nome da interface mantido como "Repository", apesar da nuance DDD
Em DDD/Clean Architecture "puro", uma abstração para um serviço externo sem estado persistido tende a ser chamada de *Gateway* ou *Port*, reservando "Repository" para acesso a agregados persistidos. Mantido `ReasoningRepository` por decisão explícita do autor do change; o benefício de desacoplamento (trocar de provedor sem mexer no caso de uso) é o mesmo independentemente do nome.

### Decision: `Conversation` como entidade de domínio + `ConversationRepository` (esse sim, persistência), implementado em arquivo
Histórico de conversa é uma entidade própria (`domain/conversation.ts`), chaveada por `(sessionId, leadJid)`, guardando os turnos (papel, texto, timestamp) e a última intenção classificada. `FileConversationRepository` persiste em arquivo local, seguindo o mesmo padrão já usado por `WarmupTracker`/`DailyVolumeLimiter` (arquivo JSON sob `.baileys_auth/`).

**Alternativas consideradas**:
- Em memória (`Map`) — rejeitada, perde todo o histórico a cada reinício do processo, contradizendo a decisão explícita de persistir.
- Banco de dados — rejeitada por ora, escopo desproporcional ao estágio atual (single-process, volume baixo); revisitar se/quando a aplicação virar um serviço distribuído.

### Decision: estrutura de pastas por feature, com camadas internas
```
src/reasoning/
  domain/
    conversation.ts
    reasoningRepository.ts
    conversationRepository.ts
  application/
    processIncomingMessage.ts
  infrastructure/
    claudeReasoningRepository.ts
    fileConversationRepository.ts
    reasoningConfig.ts
```
Consistente com o padrão já existente (`whatsapp/`, `warmup/`, `outbound/` — uma pasta por feature técnica), mas aplicando separação de camadas dentro da feature nova, como pedido explicitamente para este change.

**Alternativa considerada**: `src/domain`, `src/application`, `src/infrastructure` no nível raiz, cobrindo todo o app. Rejeitada — destoaria do restante do código já existente (que não segue esse formato) e exigiria tocar código não relacionado a este change só para "se encaixar" na nova organização.

### Decision: `WhatsAppSession` emite um novo evento `message`, já filtrado
A filtragem (excluir grupos, excluir `fromMe`) acontece dentro de `WhatsAppSession`, que já processa `messages.upsert` para as marcações de leitura — mantém o caso de uso do lado de raciocínio livre de qualquer conhecimento sobre o formato de mensagens do Baileys. Payload mínimo: `sessionId`, remetente (JID do lead), texto, timestamp.

### Decision: caso de uso orquestrado manualmente em `index.ts`, sem container de DI
Segue o mesmo estilo já usado para `SessionManager`/`SendQueue` (construídos manualmente em `index.ts`). Introduzir um framework de DI seria desproporcional ao tamanho atual do projeto.

### Decision: resposta automática entra na `SendQueue` existente, não em `session.sendMessage` direto
Garante que o warmup gate por sessão e o teto diário se apliquem a respostas automáticas exatamente como se aplicam a envios manuais/de campanha. O caso de uso depende de uma função de envio (mesmo padrão já usado na construção da `SendQueue` em `index.ts`), não da sessão diretamente.

### Decision: intenção classificada é apenas persistida nesta versão — sem reação automática
Decisão explícita de produto: evita construir um mecanismo de bloqueio contra um conceito de "lead"/"contato" que ainda não existe de forma independente do histórico de conversa. RF-07 (opt-out efetivo) e RF-05 (handoff) ficam para changes futuros dedicados.

### Decision: system prompt + modelo Claude no mesmo arquivo de configuração externo
Um único arquivo (formato exato — YAML vs. Markdown com front-matter — fica em aberto, ver Open Questions) define tanto o texto do system prompt quanto o nome do modelo usado, carregado uma vez na inicialização por `infrastructure/reasoningConfig.ts`. Não há variável de ambiente separada para o modelo.

### Decision: API key da Anthropic via variável de ambiente padrão do SDK
`ANTHROPIC_API_KEY`, seguindo a convenção que o próprio SDK oficial já lê automaticamente — sem inventar um nome de variável próprio do projeto.

## Risks / Trade-offs

- [Risk] Persistência em arquivo do histórico de conversa não é segura sob múltiplos processos concorrentes. → [Mitigation] Aceito por ora, mesma limitação já documentada para `WarmupTracker`/`DailyVolumeLimiter`; revisitar se a aplicação virar um serviço distribuído/multi-processo.
- [Risk] Latência ou indisponibilidade da API da Anthropic pode ultrapassar o RNF de resposta em até 5s, ou falhar completamente. → [Mitigation] Fora de escopo deste change adicionar retry/fallback; falhas são logadas e o processamento segue adiante, mesmo padrão já usado para falhas de envio. Revisitar se o QA manual mostrar que isso é disruptivo demais.
- [Risk] Responder automaticamente a qualquer mensagem 1:1 recebida (sem noção de lead/campanha) pode gerar respostas automáticas para contatos pessoais que mandem mensagem ao número pareado por motivos não relacionados a prospecção. → [Mitigation] Aceito nesta etapa, dado que RF-01/RF-02 ainda não existem; revisitar quando houver um conceito de lead/campanha para restringir o gatilho a leads conhecidos.
- [Risk] Acoplar geração de resposta e classificação de intenção numa única chamada estruturada torna o formato de saída (tool schema) específico do provedor Claude. → [Mitigation] `ClaudeReasoningRepository` é responsável por traduzir a saída estruturada da Claude para o formato `{ replyText, intent }` agnóstico de provedor; uma implementação futura para outro provedor precisa fazer a mesma tradução.

## Migration Plan

Não há dados existentes a migrar (capability nova). Rollout depende de `ANTHROPIC_API_KEY` e do arquivo de configuração de raciocínio estarem presentes — na ausência de qualquer um dos dois, a aplicação deve falhar rápido na inicialização em vez de simplesmente não responder silenciosamente. Rollback é reverter o código/config, sem passos adicionais.

## Open Questions

- Formato exato do arquivo de configuração externo (system prompt + modelo): YAML simples vs. Markdown com front-matter. Não muda a abordagem nem as specs — decidir na implementação.
- Forma exata de persistência em disco do histórico de conversa (caminho, nome de arquivo por lead). Detalhe de implementação, não altera comportamento observável.
- Qual modelo Claude usar como default no arquivo de configuração. Não muda a abordagem — decidir na implementação, com um valor sensato para custo/latência (RNF de até 5s).
