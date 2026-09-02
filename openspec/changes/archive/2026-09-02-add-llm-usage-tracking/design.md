## Context

Ver `proposal.md — Why`. Estado atual relevante:

- `LlmClientPort.generate(request): Promise<LlmResponse>` e `LlmResponse` só carrega
  `{ text }`. `AnthropicLlmClient` faz `this.client.messages.create(params)` e **descarta**
  `message.usage` e `message.model`. O SDK (`@anthropic-ai/sdk@0.122`) expõe em
  `message.usage`: `input_tokens`, `output_tokens`, `cache_read_input_tokens`,
  `cache_creation_input_tokens` (os dois últimos podem vir `null`); `message.model` traz o
  modelo resolvido; o `request-id` sai por `.messages.create(...).withResponse()` ou pelo
  campo `_request_id` anexado à resposta.
- Há **duas** chamadas ao LLM por turno: (#1) extração de sinais em
  `LexicalRetrievalBusinessContext.extractSignals()` (modelo `EXTRACTION_LLM_MODEL`,
  default Haiku); (#2) geração da decisão em `GenerateReplyUseCase.interpretOnce()` via
  `ReplyStrategy.buildRequest()` (modelo `LLM_MODEL`, default Sonnet). A #2 roda dentro de
  `interpretWithRetry` — até duas execuções reais em caso de falha na primeira.
- `GenerateReplyUseCase.execute(leadPhone, messageIds)` conhece o `leadPhone`.
  `LexicalRetrievalBusinessContext.getContext({ conversation, newMessages })` conhece a
  `conversation` (logo, o `leadPhone`).
- `add-embedded-sql-store` já entregou: `openDatabase(path)` → `DatabaseSync` única do
  processo (WAL, `foreign_keys=ON`), migrations forward-only em
  `src/shared/persistence/sqlite/migrations/NNNN_*.sql` aplicadas no boot, `main.ts`
  exporta `database`. Migration `0001_init` cria só `schema_migrations`; nenhuma tabela de
  negócio existe ainda.
- Config por zod com fail-fast em `src/conversation-engine/infrastructure/config/env.ts`
  (`loadConversationEngineEnv`), dois loaders de env no projeto.
- `consumption-metrics` é capability nova; `add-whatsapp-messaging-cost-tracking` vai
  estender a mesma capability com a fonte WhatsApp e reusar o mesmo formato de agregação.

## Goals / Non-Goals

**Goals:**

- Uma linha append-only por chamada real ao LLM, com atribuição suficiente para as telas de
  consumo (`timestamp`, `leadPhone?`, `callType`, `model`, 4 contadores de token,
  `requestId?`).
- Custo **derivado na leitura** a partir de tabela de preços versionada em código — nunca
  gravado congelado — de forma que corrigir um preço não reescreve histórico.
- Consultas de agregação internas (total e por dia/lead/modelo/callType num intervalo)
  prontas para a `add-management-api` consumir, no mesmo formato que a fonte WhatsApp vai
  usar depois.
- Registro estritamente best-effort: nenhum caminho novo pode alterar a decisão, o texto
  enviado, o retry ou o comportamento de erro atuais.

**Non-Goals:**

- Nenhuma rota HTTP, comando, UI ou job (limpeza/retention job fica para depois).
- Reconciliação com a fatura real da Anthropic / API de billing — o custo é **estimativa**.
- Fonte WhatsApp (outra change).
- Backfill de consumo histórico (não há dado anterior).
- Distinção de TTL de cache-write (`ephemeral_5m` vs `ephemeral_1h`) — agrega-se
  `cache_creation_input_tokens` como um número só.

## Decisions

### D1 — `usage` obrigatório em `LlmResponse` (BREAKING no contrato da port)

`LlmResponse` passa a ser `{ text: string; usage: LlmUsage }`, com:

```
interface LlmUsage {
  model: string;          // modelo efetivamente usado (message.model)
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;   // 0 quando o SDK devolve null
  cacheWriteTokens: number;  // cache_creation_input_tokens; 0 quando null
  requestId?: string;        // request-id da Anthropic quando disponível
}
```

Obrigatório, não opcional: força todo implementador e todo fake de teste a fornecer o dado
e evita ramo "usage pode faltar" espalhado pelo código. A superfície de implementadores é
pequena (um adapter de produção + fakes de teste).

`AnthropicLlmClient.generate()` passa a usar
`const { data: message, response } = await this.client.messages.create(params).withResponse()`,
mapear `message.usage`/`message.model` para `LlmUsage` e ler o `request-id` do header da
`response` (fallback `undefined`). O resto do adapter (extração de texto, tratamento de
`APIError`) não muda.

**Alternativa:** campo opcional `usage?`. Rejeitada — deixa o dado "sumir" silenciosamente
e obriga guardas em todo consumidor. **Alternativa:** um segundo método na port
(`generateWithUsage`). Rejeitada — duplica a superfície da port sem ganho.

### D2 — `UsageRecorderPort` chamado **nos call sites**, não dentro do `LlmClient`

Novo `src/conversation-engine/application/ports/usage-recorder.port.ts`:

```
type LlmCallType = "reply-generation" | "signal-extraction";

interface LlmUsageEvent {
  occurredAt: Date;
  callType: LlmCallType;
  leadPhone?: string;
  usage: LlmUsage;
}

interface UsageRecorderPort {
  recordLlmCall(event: LlmUsageEvent): Promise<void>;
}
```

Quem chama: `GenerateReplyUseCase` (após cada `interpretOnce` bem-sucedido, `callType:
"reply-generation"`, `leadPhone` do parâmetro) e `LexicalRetrievalBusinessContext` (após a
chamada #1 retornar, `callType: "signal-extraction"`, `leadPhone` de
`input.conversation`). O `AnthropicLlmClient` **não** conhece o recorder — ele não sabe
`callType` nem `leadPhone`, e mantê-lo como adapter fino de provider é intencional
(`llm-client.port` é "agnóstico de provider"). O `LlmClient` só devolve `usage`; a
atribuição e o registro são responsabilidade de quem tem o contexto de negócio.

**Alternativa:** decorar `LlmClientPort` com um `RecordingLlmClient`. Rejeitada — o
decorator não tem `callType`/`leadPhone`; teria que recebê-los por algum canal lateral
(mutação de request, AsyncLocalStorage), o que é mais frágil do que uma chamada explícita.

### D3 — Best-effort em duas camadas

1. O adapter `SqliteUsageRecorder.recordLlmCall()` nunca rejeita: envolve o `INSERT` em
   `try/catch`, loga `warn` no erro e resolve `void`.
2. Os call sites ainda assim não deixam o registro no caminho crítico: chamam
   `void this.usageRecorder.recordLlmCall(...).catch(() => {})` (sem `await` bloqueante) ou
   `await` dentro de `try/catch` que só loga. A decisão, o `save()` e o envio das mensagens
   acontecem independentemente do resultado do registro.

Quando o tracking está desligado (D6), injeta-se um `NoopUsageRecorder` cujo
`recordLlmCall` resolve imediatamente — nenhum ramo condicional nos call sites.

### D4 — Tabela `llm_usage_events` append-only (migration `0002`)

`src/shared/persistence/sqlite/migrations/0002_llm_usage_events.sql`:

```
CREATE TABLE llm_usage_events (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at        TEXT    NOT NULL,           -- ISO-8601 UTC
  call_type          TEXT    NOT NULL,           -- 'reply-generation' | 'signal-extraction'
  lead_phone         TEXT,                       -- NULL quando não há lead associado
  model              TEXT    NOT NULL,
  input_tokens       INTEGER NOT NULL,
  output_tokens      INTEGER NOT NULL,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  request_id         TEXT,
  price_version      TEXT    NOT NULL,           -- versão da tabela de preços vigente na escrita
  recorded_at        TEXT    NOT NULL            -- quando a linha foi gravada
);

CREATE INDEX idx_llm_usage_events_occurred_at ON llm_usage_events (occurred_at);
CREATE INDEX idx_llm_usage_events_lead        ON llm_usage_events (lead_phone);
CREATE INDEX idx_llm_usage_events_model       ON llm_usage_events (model);
```

Somente `INSERT`. Nunca `UPDATE`/`DELETE` no caminho da aplicação (limpeza por retenção é
job futuro, fora de escopo). `price_version` é gravado junto: é a âncora que torna a
derivação de custo estável mesmo se a tabela de preços em código mudar depois (ver D5).
`id` autoincrement em vez de UUID — processo único, conexão única, sem necessidade de id
gerado fora do banco.

**Alternativa:** gravar `estimated_cost_usd` na linha. Rejeitada pelo `proposal.md` — custo
congelado impede recalcular quando a tabela de preços é corrigida; `price_version` dá o
melhor dos dois (estável e recomputável).

### D5 — Tabela de preços versionada em código

`src/conversation-engine/infrastructure/pricing/anthropic-prices.ts`:

```
interface ModelPrice {
  model: string;
  effectiveFrom: string;      // 'YYYY-MM-DD'
  usdPerMTokInput: number;
  usdPerMTokOutput: number;
  usdPerMTokCacheRead: number;
  usdPerMTokCacheWrite: number;
}

const PRICE_TABLE_VERSION = "2026-09-02";
const ANTHROPIC_PRICES: ModelPrice[] = [ /* Sonnet, Haiku, ... */ ];
```

`priceFor(model, onDate)` → a entrada de maior `effectiveFrom` ≤ `onDate` para aquele
`model`; nenhuma → `undefined`. `costOf(tokens, price)` soma
`tokenCount/1_000_000 * usdPerMTok...` por tipo de token. Modelo sem preço → custo
`null`/indisponível, tokens seguem agregáveis.

`PRICE_TABLE_VERSION` é o valor gravado em `price_version`. Mudou a tabela → bump da versão;
linhas antigas continuam apontando para a versão antiga. (Na prática a derivação usa
`occurred_at` + `effectiveFrom`; `price_version` é rastreabilidade e desempate.)

Valores em código, não em tabela SQL: preço é regra de negócio versionada com o código,
revisável em PR, sem migration para ajustar um número. Poucas linhas, muda raramente.

**Alternativa:** tabela `model_prices` no banco. Rejeitada — vira migration a cada ajuste
de preço e não ganha nada num deploy de processo único.

### D6 — Flag `LLM_USAGE_TRACKING_ENABLED`

Nova em `conversation-engine/infrastructure/config/env.ts`:
`LLM_USAGE_TRACKING_ENABLED` (`z.coerce.boolean()` / `"true"|"false"`, default `true`).
`true` → `main.ts` injeta `SqliteUsageRecorder(database)`; `false` → `NoopUsageRecorder`.
`.env.example` ganha a variável. Sem env novo além dessa.

### D7 — Consultas de agregação

`src/conversation-engine/infrastructure/persistence/sqlite-llm-usage-queries.ts` (nome a
confirmar na implementação) expõe funções puras sobre a conexão:

- `sumInRange({ from, to })` → totais de token + custo estimado.
- `byDay`, `byLead`, `byModel`, `byCallType` ({ from, to }) → uma linha por grupo.

Como o custo depende do `model`, o SQL agrupa sempre por `(bucket, model)` e soma tokens;
o custo é aplicado em JS por linha (via `priceFor`/`costOf`) e re-somado no bucket pedido.
Assim `byDay` sobre múltiplos modelos continua correto. Intervalo sem linhas → zeros/série
vazia (sem erro). Se a tabela ainda não existe (deploy sem esta change), o consumidor
(`add-management-api`, D6 daquela change) trata "no such table" como "sem dados" — aqui não
é problema porque a migration é parte da change.

Nenhuma dessas funções abre conexão, registra rota ou expõe superfície — são chamadas pela
API de gestão numa change posterior.

### D8 — Contagem em retry é contagem correta

`interpretWithRetry` pode executar `interpretOnce` duas vezes. Cada execução que **retorna**
é uma chamada de fato faturada pela Anthropic → grava-se um evento por execução
bem-sucedida. Uma tentativa que lança antes de retornar não produz `usage` e não gera
linha. Isso é o comportamento desejado (mede o gasto real), não um bug de dupla contagem.

## Risks / Trade-offs

- **[BREAKING em `LlmResponse`]** → todos os fakes/mocks de `LlmClientPort` nos testes
  (`generate-reply.use-case.test.ts`, `lexical-retrieval.business-context.test.ts`,
  `anthropic-llm-client.test.ts`) precisam devolver `usage`. Mitigação: um helper de teste
  `fakeLlmResponse(text, partialUsage?)` e varredura por implementações da port na mesma
  change.
- **[`.withResponse()` muda a forma da chamada no adapter]** → cobrir com o teste de SDK
  mockado já existente; se o mock não suportar `.withResponse()`, ajustar o mock para
  expor `{ data, response }` (o SDK real suporta desde muito antes da 0.122).
- **[Contadores `null` do SDK]** (`cache_*` quando não há cache) → coerção explícita para
  `0` no mapeamento; teste com `usage` sem os campos de cache.
- **[Custo estimado diverge da fatura real]** (arredondamento, preços regionais, mudança de
  preço não capturada) → documentado como estimativa; reconciliação é non-goal.
- **[Fronteira de "dia" ambígua]** → `occurred_at` sempre ISO-8601 UTC; agregação `byDay`
  corta em dia UTC. Se a UI quiser fuso local, converte na leitura (decisão da
  `add-management-api`).
- **[`lead_phone` em claro no banco]** → mesma exposição que o repositório de conversas em
  arquivo já tem; sem requisito novo de PII nesta change.
- **[Escrita síncrona `node:sqlite` no caminho do turno]** → um `INSERT` numa tabela pequena
  com WAL é barato; ainda assim o registro é best-effort e fora do await crítico (D3).

## Migration Plan

1. Port + adapter: `usage` em `LlmResponse`, `AnthropicLlmClient` mapeia via
   `.withResponse()`. Atualizar fakes de teste.
2. `usage-recorder.port.ts` + `SqliteUsageRecorder` + `NoopUsageRecorder`.
3. Migration `0002_llm_usage_events.sql` (aplicada no boot pelo runner existente).
4. `anthropic-prices.ts` (tabela + `priceFor`/`costOf` + `PRICE_TABLE_VERSION`).
5. Fiação em `main.ts`: ler `LLM_USAGE_TRACKING_ENABLED`, construir o recorder (Sqlite ou
   Noop) a partir da `database` já exportada, injetar em `GenerateReplyUseCase` e
   `LexicalRetrievalBusinessContext`. `.env.example` atualizado.
6. Chamar `recordLlmCall` nos dois call sites (best-effort, D3).
7. Módulo de agregação (D7) + testes.
8. **Rollback:** `LLM_USAGE_TRACKING_ENABLED=false` (ou reverter a fiação) → `NoopRecorder`,
   nenhuma escrita. A tabela `llm_usage_events` fica órfã e inócua; `usage` em
   `LlmResponse` é inerte se ninguém consome. Nenhum dado de conversa em risco.
9. Sem backfill: as métricas começam a existir a partir do deploy.

## Open Questions

- Números exatos de US$/MTok por modelo para semear `ANTHROPIC_PRICES` — preencher na
  implementação a partir da página de preços vigente; não afeta o desenho.
- Nome final do módulo de agregação e assinatura exata dos filtros de data (ISO vs epoch) —
  alinhar quando a `add-management-api` for implementada; não muda specs nem tabela.
