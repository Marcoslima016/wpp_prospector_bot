## Why

Toda resposta do bot custa tokens da Anthropic (chamada de geração da decisão + chamada de
extração de sinais do RAG), mas hoje o `AnthropicLlmClient` **descarta `message.usage`** —
não há como saber quanto o bot consome, por lead, por modelo ou ao longo do tempo. O painel
de gestão precisa de "estatísticas de consumo", e a metade LLM desse número não tem dado de
origem.

Ver o explore em `docs/explores/explore-ui-dashboard.md` (§1.2, §1.6).

## What Changes

- **`LlmClientPort` passa a expor uso** (**BREAKING** no contrato da port): `LlmResponse`
  ganha `usage` com `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens` e
  o `model` efetivamente usado. `AnthropicLlmClient` mapeia `message.usage`.
- **Novo port `UsageRecorderPort`** (`recordLlmCall(event)`), com adapter que grava em
  `operational-data-store` (tabela **append-only** `llm_usage_events`, uma linha por
  chamada). Nunca `UPDATE` de acumulado — série temporal.
- **Atribuição por chamada**: `timestamp`, `leadPhone` (quando houver), `callType`
  (`reply-generation` | `signal-extraction`), `model`, os quatro contadores de token e o
  `requestId` da Anthropic quando disponível.
- **Estimativa de custo**: tabela de preços por modelo **versionada em código**
  (US$/milhão de tokens, por tipo de token), com data de vigência. O custo é derivado na
  leitura/agregação, não gravado congelado (ou gravado com o `priceVersion` usado).
- **Fiação**: `GenerateReplyUseCase` e o `LexicalRetrievalBusinessContext` (chamada #1)
  passam a receber o `UsageRecorder` e registrar cada chamada. Falha ao registrar consumo
  **não derruba** a geração da resposta (best-effort, logada).
- **Consultas de agregação** internas: total e por dia/lead/modelo/callType num intervalo —
  base para os endpoints da `add-management-api`.
- `.env` de exemplo / testes ajustados se surgir env novo (ex.: ligar/desligar o registro).

## Capabilities

### New Capabilities
- `consumption-metrics`: o sistema registra, de forma append-only e com timestamp, o
  consumo de recursos pagos por interação do bot e disponibiliza agregações por período.
  Esta change cobre a **fonte LLM** (tokens e custo estimado por chamada à Anthropic,
  atribuídos a lead / modelo / tipo de chamada). A fonte WhatsApp entra em
  `add-whatsapp-messaging-cost-tracking`.

### Modified Capabilities
- `conversation-engine`: o requisito **"Interpretação de Mensagem Recebida via LLM"** passa
  a exigir que cada chamada ao LLM (geração da decisão e extração de sinais) tenha seu
  consumo de tokens registrado; o registro é best-effort e não altera o resultado da
  interpretação nem a falha/retry existentes.

## Impact

- **Contrato**: `LlmClientPort`/`LlmResponse` mudam — todos os implementadores e chamadores
  (`AnthropicLlmClient`, testes com SDK mockado, `ReplyStrategy`, `LexicalRetrievalBusinessContext`)
  são atualizados. **BREAKING** interno.
- **Código**:
  - `src/conversation-engine/application/ports/llm-client.port.ts` — `usage` em `LlmResponse`;
  - novo `application/ports/usage-recorder.port.ts`;
  - `src/conversation-engine/infrastructure/llm/anthropic-llm-client.ts` — mapear `usage`;
  - novo adapter `infrastructure/persistence/.../sqlite-usage-recorder.ts` + migration
    `llm_usage_events`;
  - nova tabela de preços versionada (ex.: `infrastructure/pricing/anthropic-prices.ts`);
  - `generate-reply.use-case.ts`, `lexical-retrieval.business-context.ts`, `main.ts` — fiação.
- **Dependência de change**: `add-embedded-sql-store` (tabela + conexão).
- **Dados**: nova tabela `llm_usage_events` (append-only). Política de retenção inicial:
  eventos crus 90 dias, agregados diários indefinidos (detalhar no design; job de limpeza
  fica para depois).
- **Fora de escopo**: custo de mensageria da Meta; qualquer endpoint HTTP ou UI; backfill
  de consumo histórico (não há dado anterior).
