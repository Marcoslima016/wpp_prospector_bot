## Context

Ver `proposal.md — Why`. Estado atual relevante:

- `webhookStatusSchema` (`src/whatsapp-connectivity/infrastructure/webhook/webhook-event.schema.ts`)
  só reconhece `id`, `status`, `timestamp`, `recipient_id` e `errors[]`. Os objetos
  `pricing` e `conversation` que a Cloud API envia dentro de cada `statuses[]` **não são
  lidos** — o zod é tolerante (`.optional()` em quase tudo), mas os campos simplesmente não
  existem no schema, logo não chegam ao domínio.
- `HandleMessageStatusUpdateUseCase.execute(raw)` é **síncrono**, cria um
  `MessageStatusUpdate` (VO com `messageId` + `status`) e faz um único `logger.info`. É
  chamado pela rota `POST /webhooks/whatsapp` dentro de um
  `void Promise.resolve().then(() => ...).catch(...)` — fora do caminho do `200`, que já foi
  enviado. Erros no handler são logados pela própria rota.
- `add-embedded-sql-store` entregou: `openDatabase(path)` → `DatabaseSync` única do processo
  (WAL, `foreign_keys=ON`), migrations forward-only em
  `src/shared/persistence/sqlite/migrations/NNNN_*.sql` aplicadas no boot. Migrations atuais:
  `0001_init`, `0002_llm_usage_events`, `0003_conversation_index`. `main.ts` exporta
  `database`.
- `add-llm-usage-tracking` já implementou a **fonte LLM** da capability
  `consumption-metrics` e fixou o padrão que esta change espelha para a fonte WhatsApp:
  - port de registro (`UsageRecorderPort`) + adapter SQLite best-effort
    (`SqliteUsageRecorder`, `try/catch` no `INSERT`, nunca rejeita) + `NoopUsageRecorder`
    para quando o tracking está desligado;
  - tabela append-only `llm_usage_events`, **sem custo gravado**, com `price_version`;
  - tabela de preços versionada em código
    (`src/conversation-engine/infrastructure/pricing/anthropic-prices.ts`:
    `PRICE_TABLE_VERSION`, `ANTHROPIC_PRICES`, `priceFor(model, onDate)`, `costOf`);
  - módulo de agregação puro sobre a conexão
    (`sqlite-llm-usage-queries.ts`: `sumInRange`, `byDay`/`byLead`/`byModel`/`byCallType`,
    `UsageTotals`/`UsageBucket` com `estimatedCostUsd` + `costPartial`);
  - flag de env (`LLM_USAGE_TRACKING_ENABLED`, default `true`) que decide Sqlite vs Noop na
    fiação em `main.ts`.
- Dois loaders de env por zod fail-fast: `loadEnv` em
  `src/whatsapp-connectivity/infrastructure/config/env.ts` e `loadConversationEngineEnv` em
  `src/conversation-engine/infrastructure/config/env.ts`. Esta change mexe no primeiro.
- A Meta cobra por **janela de conversa de 24 h**, não por mensagem, e o preço por conversa
  varia por **categoria** (`marketing` | `utility` | `service` | `authentication`) e por
  **país do destinatário**. O evento de status pode trazer `pricing`/`conversation` em
  alguns status (tipicamente o primeiro status faturável da janela) e não em outros; nem
  toda conversa gera cobrança (entry points gratuitos, service conversations dentro da cota
  grátis).

## Goals / Non-Goals

**Goals:**

- Ler `statuses[].pricing` e `statuses[].conversation` do webhook de forma tolerante e
  carregá-los até a use-case de status.
- Uma linha append-only por **janela de conversa de 24 h** faturável, deduplicada por
  `conversationId`, com atribuição suficiente para as telas de consumo (`occurredAt`,
  `conversationId`, `recipientId`, `category`, `originType`, `pricingModel`, `billable`,
  `expirationTimestamp?`).
- Custo **derivado na leitura** a partir de uma tabela de preços da Meta versionada em
  código (por categoria × país-base) — nunca gravado congelado; corrigir um preço não
  reescreve histórico.
- Consultas de agregação internas (total e por dia/categoria/lead num intervalo) no **mesmo
  formato** que a fonte LLM (`sumInRange` + agrupamentos, totais com custo estimado e flag
  de custo parcial).
- Registro estritamente best-effort: nenhum caminho novo altera o `200` rápido, o log atual
  do handler de status, nem o recebimento de eventos subsequentes.

**Non-Goals:**

- Nenhuma rota HTTP, comando, UI ou job de retenção (retenção acompanha a das métricas de
  LLM, tratada depois).
- Reconciliação com a fatura real da Meta / WhatsApp Billing API — o custo é **estimativa**.
- Resolver o país real de cada destinatário: o MVP usa um país-base configurável.
- Modelo de precificação **por mensagem** que a Meta introduziu para parte das categorias —
  o MVP modela por janela de conversa; a tabela de preços versionada permite evoluir depois.
- Backfill de conversas anteriores ao deploy (não há dado histórico de `pricing`).
- Persistir estado da janela de 24 h para envio de mensagem de sessão (continua delegado à
  Cloud API, como hoje).

## Decisions

### D1 — `webhookStatusSchema` estendido com `pricing` e `conversation` opcionais e tolerantes

Adicionar ao schema, ambos `.optional()`:

```
pricing: z.object({
  billable: z.boolean().optional(),
  pricing_model: z.string().optional(),   // ex.: 'CBP', 'PMP'
  category: z.string().optional(),        // 'marketing' | 'utility' | 'service' | 'authentication'
}).passthrough().optional(),

conversation: z.object({
  id: z.string().optional(),
  origin: z.object({ type: z.string().optional() }).passthrough().optional(),
  expiration_timestamp: z.string().optional(),
}).passthrough().optional(),
```

`category` e `pricing_model` ficam como `z.string()` (não `z.enum`) e a normalização/validação
de valor acontece no domínio — mantém a postura "campo desconhecido não derruba parsing" já
adotada no resto do schema (`type: z.string()` nas mensagens). `.passthrough()` para não
quebrar quando a Meta adicionar campos. `WebhookStatus` (tipo inferido) passa a carregar os
dois objetos; `RawMessageStatusUpdate` na use-case ganha os mesmos campos opcionais.

**Alternativa:** `z.enum` em `category`. Rejeitada — um valor novo da Meta derrubaria o
parsing do evento inteiro (e, hoje, o schema é a única barreira antes do `200`).

### D2 — VO `WhatsappConversationBilling` no domínio, derivado da use-case

Novo VO em `src/whatsapp-connectivity/domain/whatsapp-conversation-billing.ts`:

```
type ConversationCategory = "marketing" | "utility" | "service" | "authentication";

class WhatsappConversationBilling {
  readonly conversationId: string;
  readonly category: ConversationCategory | "unknown";
  readonly originType: string;
  readonly pricingModel: string;
  readonly billable: boolean;
  readonly expirationTimestamp?: Date;
  static fromWebhook(pricing?, conversation?): WhatsappConversationBilling | null;
}
```

`fromWebhook` devolve `null` quando **não há `conversation.id`** (sem chave de dedup não há o
que registrar) — os demais campos são preenchidos com defaults tolerantes (`category`
desconhecida → `"unknown"`, `billable` ausente → `false`). `MessageStatusUpdate` **não
muda**: continua `messageId` + `status`. A use-case passa a receber, além do VO de status, o
`billing` (ou `null`) e o `recipientId`/`timestamp` que já tem em `raw`, e chama o recorder.

**Alternativa:** enfiar os campos de billing dentro de `MessageStatusUpdate`. Rejeitada —
mistura duas responsabilidades (status de entrega × faturamento de conversa) num VO que
outros pontos já consomem só pelo status.

### D3 — Novo port `MessagingCostRecorderPort`, chamado na use-case

`src/whatsapp-connectivity/application/ports/messaging-cost-recorder.port.ts`:

```
interface WhatsappConversationEvent {
  occurredAt: Date;
  conversationId: string;
  recipientId: string;
  category: ConversationCategory | "unknown";
  originType: string;
  pricingModel: string;
  billable: boolean;
  expirationTimestamp?: Date;
}

interface MessagingCostRecorderPort {
  recordConversationEvent(event: WhatsappConversationEvent): Promise<void>;
}
```

`HandleMessageStatusUpdateUseCase` recebe o recorder como dependência opcional (default
`NoopMessagingCostRecorder`). Após o `logger.info` atual, se houver `billing`, chama
`void this.recorder.recordConversationEvent(...).catch(() => {})` — sem `await` no caminho.
O `execute` continua síncrono (a rota já o roda fora do `200`). Espelha o D2 de
`add-llm-usage-tracking`: quem tem o contexto de negócio (categoria, lead, instante) faz o
registro; o adapter não conhece webhook.

### D4 — Best-effort em duas camadas (igual à fonte LLM)

1. `SqliteMessagingCostRecorder.recordConversationEvent` envolve o `INSERT` em `try/catch`,
   loga `warn` e resolve `void` — nunca rejeita.
2. A use-case chama sem `await` bloqueante (`void ...catch(() => {})`). O log do status e o
   `200` já enviado independem do resultado.

Tracking desligado → `NoopMessagingCostRecorder` (resolve na hora), sem ramo condicional na
use-case.

### D5 — Migration `0004_whatsapp_conversation_events.sql` (append-only + dedup por conversa)

```
CREATE TABLE whatsapp_conversation_events (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at           TEXT    NOT NULL,          -- ISO-8601 UTC (timestamp do evento de status)
  conversation_id       TEXT    NOT NULL UNIQUE,   -- chave de dedup da janela de 24 h
  recipient_id          TEXT    NOT NULL,          -- telefone do lead
  category              TEXT    NOT NULL,          -- 'marketing'|'utility'|'service'|'authentication'|'unknown'
  origin_type           TEXT    NOT NULL,
  pricing_model         TEXT    NOT NULL,
  billable              INTEGER NOT NULL,          -- 0 | 1
  expiration_timestamp  TEXT,                      -- ISO-8601 UTC quando presente
  billing_country       TEXT    NOT NULL,          -- país-base assumido na escrita (D6)
  price_version         TEXT    NOT NULL,          -- versão da tabela de preços Meta vigente na escrita
  recorded_at           TEXT    NOT NULL           -- ISO-8601 UTC, quando a linha foi gravada
);

CREATE INDEX idx_wce_occurred_at ON whatsapp_conversation_events (occurred_at);
CREATE INDEX idx_wce_category    ON whatsapp_conversation_events (category);
CREATE INDEX idx_wce_recipient   ON whatsapp_conversation_events (recipient_id);
```

O `INSERT` do adapter usa `INSERT ... ON CONFLICT(conversation_id) DO NOTHING`: o primeiro
evento de status observado para a janela grava a linha; os seguintes (mesma janela,
`delivered`/`read`) não fazem nada. Somente `INSERT`; nunca `UPDATE`/`DELETE` no caminho da
aplicação. Custo **não** é coluna — derivado na leitura (D6). `billing_country` e
`price_version` gravados junto: âncoras para derivação de custo estável se a tabela em
código mudar depois. `id` autoincrement (processo/conexão únicos), consistente com
`llm_usage_events`.

**Alternativa:** dedup por `(conversation_id, category)`. Rejeitada — a Meta define a janela
de 24 h pelo `conversation.id`; a categoria não muda dentro da mesma janela, e tratá-la como
parte da chave abriria porta para dupla contagem por variação de string.

### D6 — Tabela de preços da Meta versionada em código + país-base configurável

`src/whatsapp-connectivity/infrastructure/pricing/meta-conversation-prices.ts`, no mesmo
molde de `anthropic-prices.ts`:

```
interface MetaConversationPrice {
  category: ConversationCategory;
  country: string;            // ISO-3166-1 alpha-2, ex.: 'BR'
  effectiveFrom: string;      // 'YYYY-MM-DD'
  usdPerConversation: number;
}

const META_PRICE_TABLE_VERSION = "2026-09-02";
const META_CONVERSATION_PRICES: readonly MetaConversationPrice[] = [ /* BR: marketing/utility/... */ ];

function priceFor(category, country, onDate): MetaConversationPrice | undefined; // maior effectiveFrom <= onDate
function costOf(conversationCount, price): number;                               // count * usdPerConversation
```

País-base via nova env `WHATSAPP_BILLING_COUNTRY` (default **`BR`** — assunção do MVP,
registrada como Open Question para o produto confirmar). `service` costuma ser gratuita em
várias regiões → preço `0` é uma entrada válida (custo `0`, não "indisponível"); ausência de
entrada para a combinação → custo indisponível, contagem mantida.

**Alternativa:** tabela `meta_prices` no banco. Rejeitada pelo mesmo motivo da fonte LLM —
vira migration a cada ajuste de número, sem ganho num deploy de processo único.

### D7 — Flag `WHATSAPP_COST_TRACKING_ENABLED` e fiação em `main.ts`

Nova em `src/whatsapp-connectivity/infrastructure/config/env.ts`:
`WHATSAPP_COST_TRACKING_ENABLED` (`z.coerce.boolean()` / `"true"|"false"`, default `true`) e
`WHATSAPP_BILLING_COUNTRY` (`z.string().length(2)`, default `"BR"`). `.env.example`
atualizado.

`main.ts`: quando `WHATSAPP_COST_TRACKING_ENABLED`, construir
`new SqliteMessagingCostRecorder(database, logger, billingCountry)` a partir da `database` já
exportada; senão `new NoopMessagingCostRecorder()`. Injetar em
`HandleMessageStatusUpdateUseCase` (hoje construído em `main.ts:170` só com `logger`).

### D8 — Consultas de agregação, mesmo formato da fonte LLM

`src/whatsapp-connectivity/infrastructure/persistence/sqlite-whatsapp-cost-queries.ts`,
funções puras sobre a conexão:

- `sumInRange({ from, to })` → `{ conversations, estimatedCostUsd, costPartial }`.
- `byDay`, `byCategory`, `byLead` (`{ from, to }`) → uma linha por grupo, mesmo shape.

O SQL agrupa sempre por `(bucket, category)` e conta conversas (`COUNT(*)` ou
`SUM(billable)` — ver Open Questions); o custo é aplicado em JS por linha via
`priceFor(category, billing_country, occurred_at)` + `costOf`, e re-somado no bucket pedido,
para que `byDay` sobre categorias mistas continue correto. `costPartial = true` quando algum
grupo tem categoria/país sem preço. Intervalo sem linhas → zeros / série vazia, sem erro.
Nenhuma dessas funções abre conexão nem expõe superfície — a `add-management-api` as consome
depois, ao lado de `sqlite-llm-usage-queries.ts`.

### D9 — `occurredAt` do evento de consumo = timestamp do evento de status

O `occurred_at` gravado é o `timestamp` do `statuses[]` (instante do evento na Meta),
convertido para ISO-8601 UTC — consistente com o que o handler já loga hoje
(`new Date(Number(raw.timestamp) * 1000).toISOString()`). É a âncora temporal da agregação
`byDay` (corte em dia UTC, como na fonte LLM).

## Risks / Trade-offs

- **[Nem todo status traz `pricing`/`conversation`]** (a Meta manda no primeiro status
  faturável da janela; alguns status vêm sem) → dedup por `conversationId` + `ON CONFLICT DO
  NOTHING` torna idempotente registrar em qualquer status que traga os dados; se nenhum
  status da janela trouxer, aquela conversa não é registrada (aceito no MVP, documentado).
- **[Conversas gratuitas / entry points free]** → `billable=false` é gravado; a agregação
  pode contar conversas e custo `0`. Se o produto quiser separar "faturável" de "grátis", a
  coluna `billable` já permite — decisão de leitura, não de schema.
- **[Modelo por-mensagem da Meta (2025+)]** → o MVP modela por janela; `pricing_model` é
  gravado, então dá para identificar linhas afetadas e evoluir a tabela de preços/queries
  numa change futura sem reescrever histórico.
- **[Custo estimado diverge da fatura real]** (país-base fixo, arredondamento, preços
  regionais, categoria estimada errada) → documentado como estimativa; reconciliação é
  non-goal.
- **[`category` = `"unknown"`]** (Meta manda categoria nova / campo ausente) → linha gravada
  com contagem, custo indisponível para o grupo `unknown`; não derruba parsing (D1).
- **[`recipient_id` / `conversation_id` em claro no banco]** → mesma exposição de PII que
  `llm_usage_events` já tem; sem requisito novo nesta change.
- **[Escrita síncrona `node:sqlite` no handler de status]** → um `INSERT` idempotente numa
  tabela pequena com WAL é barato, e é best-effort fora do await (D4). O handler já roda
  fora do `200`.
- **[`UNIQUE(conversation_id)` em corrida]** → processo e conexão únicos; `ON CONFLICT DO
  NOTHING` cobre o caso de dois status da mesma janela no mesmo tick.

## Migration Plan

1. Schema: `pricing`/`conversation` opcionais em `webhookStatusSchema` + tipos;
   `RawMessageStatusUpdate` ganha os campos. Atualizar/estender testes do schema.
2. Domínio: `WhatsappConversationBilling` + `fromWebhook` (+ testes).
3. Port `messaging-cost-recorder.port.ts` + `NoopMessagingCostRecorder`.
4. Migration `0004_whatsapp_conversation_events.sql` (aplicada no boot pelo runner
   existente) + teste da migration (`:memory:`, colunas/índices/UNIQUE).
5. `SqliteMessagingCostRecorder` (`INSERT ... ON CONFLICT DO NOTHING`, `try/catch`, `warn`,
   nunca rejeita; grava `billing_country`, `META_PRICE_TABLE_VERSION`, `recorded_at`) +
   testes.
6. `meta-conversation-prices.ts` (tabela + `priceFor`/`costOf` + `META_PRICE_TABLE_VERSION`)
   + testes.
7. Env: `WHATSAPP_COST_TRACKING_ENABLED` + `WHATSAPP_BILLING_COUNTRY` no zod + `.env.example`.
8. `HandleMessageStatusUpdateUseCase`: receber o recorder, extrair `billing` de `raw`,
   registrar best-effort após o log. Testes: registra quando há `pricing`/`conversation`;
   não registra sem eles; falha do recorder não quebra o handler; `Noop` = comportamento
   atual.
9. `main.ts`: ler as envs, construir Sqlite ou Noop recorder da `database` exportada,
   injetar na use-case de status.
10. Módulo de agregação `sqlite-whatsapp-cost-queries.ts` + testes (múltiplos dias,
    categorias, leads; categoria sem preço; intervalo vazio).
11. **Rollback:** `WHATSAPP_COST_TRACKING_ENABLED=false` → `NoopMessagingCostRecorder`,
    nenhuma escrita. A tabela `whatsapp_conversation_events` fica órfã e inócua; os campos
    novos do schema são inertes se ninguém os consome. Nenhum dado de conversa/entrega em
    risco. Sem backfill — as métricas de WhatsApp começam no deploy.

## Open Questions

- Valores exatos de US$/conversa por categoria para o país-base — preencher na implementação
  a partir da rate card vigente da Meta; não afeta o desenho.
- País-base default (`BR` assumido) — confirmar com o produto; troca só muda o valor de env
  e as entradas semeadas, não specs nem schema.
- Contagem de "conversas" na agregação: `COUNT(*)` de janelas registradas vs `SUM(billable)`
  — alinhar com a `add-management-api` quando os endpoints forem desenhados; ambos saem das
  mesmas linhas, sem mudança de schema.
- Nome final do módulo de agregação e assinatura dos filtros de data (ISO vs epoch) —
  alinhar com a fonte LLM na `add-management-api`.
