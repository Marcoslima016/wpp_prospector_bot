## Context

Ver `proposal.md — Why`. Estado atual relevante:

- `GenerateReplyUseCase` monta a requisição ao LLM via `ReplyStrategy.buildRequest`, que
  hoje só usa `promptText` (persona, lido 1× no boot em `main.ts`) + histórico + mensagens
  novas. Uma única chamada ao LLM produz a `BotDecision`.
- `AnthropicLlmClient` implementa `LlmClientPort` com saída estruturada
  (`output_config.format`). O motor é agnóstico de provider.
- Config validada por zod em `infrastructure/config/env.ts`, com **fail-fast**: config
  inválida lança e o processo não sobe.
- Conversa persistida como 1 JSON por lead; turnos outbound guardam
  `leadIntent`/`leadQualification`/`reasoning`.
- Modelo: `claude-sonnet-5` (env `LLM_MODEL`). Janela de rajada: 8 s.
- Fonte do conhecimento: `docs/payloads/base_conhecimento_bot_vendas_obra_na_mao.txt` e
  `docs/payloads/modulos_funcionalidades_obra_na_mao_bot_vendas.txt` (~16k + ~15k tokens
  crus, ~60% sobrepostos).

Decisões de produto já fechadas no explore (`docs/explores/explore-business-knowledge.md`):
planos **Essencial R$ 300/mês** e **Personalizado R$ 500/mês**; split base = campo + admin
+ DRE, adicional = Artisys Finance / Universidade / Jogos / Assistente; abordagem **RAG
léxico local, 2 chamadas**; **fail-fast** no boot; schema ganha 3 campos.

## Goals / Non-Goals

**Goals:**

- Isolar a fonte do contexto de negócio atrás de um port, para que a técnica de
  recuperação seja trocável sem tocar `domain` nem o use case.
- Manter o `domain` recebendo apenas uma `string` de contexto — sem conhecer RAG.
- Preservar o prompt caching do prefixo estável (persona + conteúdo fixo) apesar do
  contexto recuperado ser variável.
- Compatibilidade de leitura das conversas já persistidas (sem script de migração).
- Ter um teste determinístico de qualidade da recuperação, sem LLM, no CI.

**Non-Goals:**

- Recuperação vetorial / embeddings.
- Persistência do índice entre reinícios (é reconstruído no boot).
- Fallback automático de runtime para "KB inteiro no prompt" (o `StaticBusinessContext`
  existe só para testes / A-B).
- Tratar mensagens não-texto, agendar demonstração ou enviar material (seguem via
  `handoffToHuman`).
- Backfill dos 3 campos novos em conversas antigas.

## Decisions

### D1 — RAG léxico local com 2 chamadas ao LLM (Opção B)

Fluxo por lote de mensagens:

```
newMessages ──► [LLM #1: extração]  → { temas[], dores[], modulosProvaveis[] }
                     │ falha/vazio → extração local (normalização + sinônimos)
                     ▼
              query léxica ──► índice BM25 (memória) ──► top-k chunks (dedupe por seção,
                                                          corta abaixo de min-score)
                     ▼
       contexto = [pinned obrigatório] + [chunks recuperados]
                     ▼
              [LLM #2: geração]  → BotDecision   (fonte única de intent/qualification)
```

- **Por que 2 chamadas**: a chamada #1 resolve linguagem conversacional/jargão que a busca
  puramente léxica erra ("meu encarregado só manda áudio" → dores =
  [comunicação campo↔escritório, falta de registro]). Escolha do usuário no explore.
- **Alternativas consideradas**: (a) *prompt-stuffing + cache* — mais barato e 1 chamada,
  recusado pelo usuário; (b) *Opção A, extração 100% local* — sem a chamada #1, vira o
  próprio fallback desta decisão; (c) *Opção C, chamada #1 condicional* — evolução futura
  possível trocando só o adapter.
- **Degradação**: falha da chamada #1 não falha o turno — cai para extração local, que é o
  comportamento da Opção A.

### D2 — Port `BusinessContextProvider`

```
application/ports/business-context.port.ts
  getContext(input: { conversation: Conversation; newMessages: string[] }): Promise<string>

infrastructure/knowledge/
  lexical-retrieval.business-context.ts   ← produção; recebe LlmClientPort + índice + config
  static.business-context.ts              ← testes / A-B; devolve KB inteiro + pricing
```

- `GenerateReplyUseCase` chama `provider.getContext(...)` antes de `replyStrategy.buildRequest`
  e repassa a string. `ReplyStrategy.buildRequest` ganha um parâmetro `businessContext: string`.
- A chamada #1 (extração) vive **dentro** do `LexicalRetrievalBusinessContext`, que recebe
  seu próprio `LlmClientPort`. O use case não sabe que existem 2 chamadas.
- Mesma lição do `LlmClientPort`: `domain` não referencia infraestrutura.
- **Alternativa**: orquestrar as 2 chamadas no use case. Recusada — vaza mecânica de
  recuperação para a camada de aplicação e engessa a troca de técnica.

### D3 — Índice BM25 em memória, reconstruído no boot

- Corpus ~150 trechos (~100–400 tokens cada). Construção < 50 ms.
- **Alternativas**: SQLite FTS5 (só vale para persistir índice / consultar de outro
  processo — desnecessário nesse tamanho); índice vetorial (fora dos goals).
- Tokenização PT-BR: lowercase + remoção de acentos + stopwords + stemming leve. O maior
  ganho vem do **mapa de sinônimos/jargão** (`synonyms.pt-br.ts`), mão-escrito:
  `andar→pavimento`, `bater ponto→presença`, `medição/aditivo→dre-custos`,
  `extrato/conciliação→artisys-finance`, `treinar equipe→universidade`, etc.

### D4 — Fail-fast no boot para preparo da base

- Base ausente/ilegível, formato inválido, trecho sem metadados, ou zero trechos → erro
  descritivo + processo não sobe. Mesma postura de `loadEnv` / `loadConversationEngineEnv`.
- Acompanha script `knowledge:validate` (parse dos `.md`, checagem de metadados por
  trecho, contagem mínima) para rodar no CI antes do deploy — torna a falha em runtime
  quase impossível.
- **Alternativa**: degradar para `StaticBusinessContext`. Recusada no explore — bot que
  desconhece o produto (ou o conhece degradado silenciosamente) é pior que outage
  detectado; e manteria vivo um segundo caminho de código que não queremos carregar.

### D5 — Curadoria e organização do conhecimento

- Os 2 payloads de `docs/payloads/` continuam como **fonte bruta**. A curadoria produz
  `src/conversation-engine/infrastructure/knowledge/sales-knowledge.md` (deduplicado,
  seccionado por `====`, cada seção com metadados) + `pricing.md`.
- Metadados por trecho: `module`, `tier` (`base` | `extra` | `geral`), `kind`
  (`visao` | `funcionalidades` | `problema-solucao` | `publico` | `guardrail` |
  `objecao` | `discovery` | `preco`). Formato exato (frontmatter vs comentário) é detalhe
  de implementação.
- **Trechos `pinned` (sempre no contexto, nunca dependem de busca)**: `kind ∈ {guardrail,
  preco}` + posicionamento curto + contrato de saída. A busca só preenche a fatia
  variável (`funcionalidades`, `problema-solucao`, `objecao`, `publico`, `discovery`).

### D6 — Composição do prompt e prompt caching

```
system:  bloco 1  persona + pinned (guardrails, preços, visão curta, contrato JSON)  ← cache_control: ephemeral
         bloco 2  chunks recuperados neste turno                                      ← sem cache_control
messages: [ ...histórico (≤ CONVERSATION_HISTORY_TURNS), ...mensagens novas ]
```

- Cache é prefix-match: mudar o bloco 2 não invalida o bloco 1. O prefixo estável
  (~persona + pinned) fica bem acima do mínimo cacheável.
- `claude-sonnet-5` não suporta system message no meio de `messages[]` — o contexto entra
  no `system` top-level.
- Implementação: o `BusinessContextProvider` devolve **uma string** (contrato do port),
  na forma `pinned` + `RETRIEVED_CONTEXT_SEPARATOR` + trechos recuperados (o separador
  fica ausente quando não há trechos). `ReplyStrategy.buildRequest` divide nesse
  separador: a parte `pinned` entra no bloco 1 (cacheável, junto da persona), os trechos
  no bloco 2. O `LlmRequest.system` passa a aceitar `string | LlmSystemBlock[]`; a
  `AnthropicLlmClient` mapeia os blocos para `text` blocks com `cache_control: ephemeral`
  no bloco cacheável.

### D7 — 3 campos novos na decisão, leitura retrocompatível

- `BOT_DECISION_JSON_SCHEMA` e `botDecisionSchema` (zod) ganham `recommendedModules:
  string[]`, `interestedModules: string[]`, `quotedPlan: enum('essencial','personalizado')
  | null`. Todos em `required` no JSON Schema (subconjunto aceito pela Anthropic).
- `ConversationTurn` (outbound) e `Conversation` (agregado) passam a serializar os campos.
- `fromJSON` aplica default (`[]` / `null`) quando ausentes → conversas antigas carregam
  sem erro, sem migração.
- Identificadores de módulo: enum estável derivado do catálogo (ex.: `gestao-obras`,
  `obra360`, `artisys-finance`, …), compartilhado com os metadados dos trechos.

### D8 — Modelo da chamada de extração

- Chamada #1 usa um modelo mais barato/rápido (candidato: `claude-haiku-4-5`), configurável
  por env, independente de `LLM_MODEL` (que segue na chamada #2). Reduz o impacto de
  latência e custo da segunda chamada.

### D9 — Avaliação de recuperação no CI

- Conjunto golden = os ~18 pares "fala do cliente → módulos esperados" já presentes nos
  payloads (`base_conhecimento §54`, `modulos_funcionalidades §30`).
- Teste determinístico (sem LLM): roda a extração **local** + busca e afere `recall@k` dos
  módulos esperados nos trechos retornados. Serve para calibrar `synonyms.pt-br.ts`,
  `RETRIEVAL_TOP_K` e `RETRIEVAL_MIN_SCORE`.

## Risks / Trade-offs

- **Latência +1–3 s por interpretação (2ª chamada sequencial)** → modelo barato na
  extração (D8); janela de rajada de 8 s já domina a percepção; caminho aberto para Opção C
  (chamada #1 condicional) trocando só o adapter.
- **Chamada de extração é novo ponto de falha** → fallback local obrigatório (D1); turno
  nunca falha por causa dela.
- **Busca léxica erra fraseado conversacional** → mapa de sinônimos + conjunto de
  avaliação no CI (D9); se o recall ficar baixo, escalar para Opção C/priorizar a chamada
  #1.
- **`.md` malformado derruba o boot (fail-fast)** → gate `knowledge:validate` no CI antes
  do deploy (D4).
- **Curadoria diverge dos payloads com o tempo** → `sales-knowledge.md` é a única fonte de
  verdade em runtime; payloads viram histórico. Curadoria refeita = editar `.md` +
  reiniciar (mesma cadência do `reply-strategy.prompt.md` atual).
- **Custo ~2× de input (~US$ 0,03/interpretação)** → prompt caching do prefixo persona +
  pinned; valor absoluto irrelevante.
- **"Personalizado" sugere seleção à la carte** → a persona descreve explicitamente como
  "plano que libera todos os módulos", e a spec proíbe oferta avulsa dos módulos extra.
- **Conteúdo recuperado empurra o histórico no orçamento de contexto** → teto de trechos
  (`RETRIEVAL_TOP_K`) e corte por `RETRIEVAL_MIN_SCORE`; `maxTokens` de saída segue 2000.

## Migration Plan

1. Curar os payloads em `sales-knowledge.md` + `pricing.md`; adicionar `knowledge:validate`
   ao CI.
2. Implementar índice, port + adapters, extensão de schema, reescrita da persona, fiação
   em `main.ts`.
3. Deploy: primeiro boot constrói o índice ou falha explicitamente (fail-fast).
4. Conversas existentes: lidas com defaults nos campos novos, sem backfill.
5. **Rollback**: reverter o deploy. Os 3 campos novos já gravados em `data/conversations/*.json`
   são aditivos e ignorados pelo código anterior (`fromJSON` só lê chaves conhecidas).

## Open Questions

- Modelo exato da chamada de extração (`claude-haiku-4-5` vs `claude-sonnet-5`) — ajustar
  com medição, não altera specs nem tarefas.
- Valores default de `RETRIEVAL_TOP_K` e `RETRIEVAL_MIN_SCORE` — calibrar com o conjunto
  de avaliação (D9).
- Necessidade de uma lib de stemming PT-BR vs. só o mapa de sinônimos — spike curto na
  implementação; sem dependência nova se o mapa bastar.
- Formato dos metadados por trecho (frontmatter YAML vs comentário HTML) — detalhe de
  implementação decidido na tarefa de curadoria.
