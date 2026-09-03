## 1. Schema do webhook (`pricing` / `conversation` no status)

- [x] 1.1 Estender `webhookStatusSchema` em `src/whatsapp-connectivity/infrastructure/webhook/webhook-event.schema.ts` com `pricing` (`billable?`, `pricing_model?`, `category?`) e `conversation` (`id?`, `origin.type?`, `expiration_timestamp?`), ambos `.optional()` e `.passthrough()`, `category`/`pricing_model` como `z.string()` (validação de valor fica no domínio) — conforme design D1
- [x] 1.2 Propagar os novos campos no tipo `WebhookStatus` e em `RawMessageStatusUpdate` (`src/whatsapp-connectivity/application/use-cases/handle-message-status-update.use-case.ts`)
- [x] 1.3 Testes do schema: evento de status com `pricing`+`conversation` completos é parseado; evento sem eles continua válido; campos desconhecidos dentro de `pricing`/`conversation` não derrubam o parsing

## 2. Domínio — `WhatsappConversationBilling`

- [x] 2.1 Criar `src/whatsapp-connectivity/domain/whatsapp-conversation-billing.ts` com `ConversationCategory` (`marketing`|`utility`|`service`|`authentication`), o VO (`conversationId`, `category | "unknown"`, `originType`, `pricingModel`, `billable`, `expirationTimestamp?`) e `fromWebhook(pricing?, conversation?)`
- [x] 2.2 `fromWebhook` devolve `null` quando não há `conversation.id`; normaliza `category` desconhecida → `"unknown"`, `billable` ausente → `false`, `expiration_timestamp` string → `Date` quando presente
- [x] 2.3 Testes do VO: mapeamento completo; `null` sem `conversation.id`; categoria desconhecida → `"unknown"`; defaults tolerantes

## 3. Port e adapters de registro de consumo de mensageria

- [x] 3.1 Criar `src/whatsapp-connectivity/application/ports/messaging-cost-recorder.port.ts` com `WhatsappConversationEvent` (`occurredAt`, `conversationId`, `recipientId`, `category`, `originType`, `pricingModel`, `billable`, `expirationTimestamp?`) e `MessagingCostRecorderPort.recordConversationEvent(event): Promise<void>`
- [x] 3.2 Criar `NoopMessagingCostRecorder` (resolve imediatamente) — usado quando o tracking está desligado
- [x] 3.3 Criar migration `src/shared/persistence/sqlite/migrations/0004_whatsapp_conversation_events.sql` com a tabela append-only (`conversation_id` `UNIQUE`, `billing_country`, `price_version`, `recorded_at`, sem coluna de custo) e os índices `occurred_at` / `category` / `recipient_id` — conforme design D5
- [x] 3.4 Teste da migration: aplicar as migrations em banco `:memory:` e verificar colunas, `UNIQUE(conversation_id)`, defaults e índices de `whatsapp_conversation_events`
- [x] 3.5 Criar `SqliteMessagingCostRecorder` (recebe conexão, logger e país-base) cujo `recordConversationEvent` faz um único `INSERT ... ON CONFLICT(conversation_id) DO NOTHING`, envolve em `try/catch`, loga `warn` no erro e nunca rejeita; grava `billing_country`, `price_version = META_PRICE_TABLE_VERSION` e `recorded_at`
- [x] 3.6 Testes do `SqliteMessagingCostRecorder`: linha gravada uma vez por `conversationId`; segundo evento do mesmo `conversationId` não cria linha nem altera a existente; erro de escrita é engolido e logado (não rejeita); linha com e sem `expirationTimestamp`

## 4. Tabela de preços da Meta versionada e custo

- [x] 4.1 Criar `src/whatsapp-connectivity/infrastructure/pricing/meta-conversation-prices.ts` com `MetaConversationPrice` (`category`, `country`, `effectiveFrom`, `usdPerConversation`), `META_PRICE_TABLE_VERSION`, `META_CONVERSATION_PRICES`, `priceFor(category, country, onDate)` e `costOf(conversationCount, price)`
- [x] 4.2 Semear as entradas do país-base (`BR`) por categoria a partir da rate card vigente da Meta, cada uma com `effectiveFrom`; `service` = `0` é entrada válida (custo `0`, não indisponível)
- [x] 4.3 Testes: `priceFor` escolhe a entrada de maior `effectiveFrom` ≤ data; combinação categoria/país sem entrada → `undefined` (custo indisponível, contagem mantida); `costOf` multiplica contagem × `usdPerConversation`

## 5. Fiação (best-effort, sem alterar o fluxo)

- [x] 5.1 Adicionar `WHATSAPP_COST_TRACKING_ENABLED` (default `true`) e `WHATSAPP_BILLING_COUNTRY` (default `"BR"`, 2 letras) ao schema zod em `src/whatsapp-connectivity/infrastructure/config/env.ts` e ao `.env.example`
- [x] 5.2 `HandleMessageStatusUpdateUseCase`: receber `recorder: MessagingCostRecorderPort` (default `NoopMessagingCostRecorder`); após o `logger.info` atual, derivar `WhatsappConversationBilling.fromWebhook(raw.pricing, raw.conversation)` e, se não-`null`, chamar `void this.recorder.recordConversationEvent(...).catch(() => {})` com `occurredAt` do `raw.timestamp` (ISO UTC) e `recipientId` de `raw.recipient_id` — sem `await` no caminho, `execute` segue síncrono
- [x] 5.3 `src/main.ts`: construir `SqliteMessagingCostRecorder(database, logger, billingCountry)` quando `WHATSAPP_COST_TRACKING_ENABLED`, senão `NoopMessagingCostRecorder`; injetar em `HandleMessageStatusUpdateUseCase` (hoje construído só com `logger`)
- [x] 5.4 Testes de `HandleMessageStatusUpdateUseCase`: registra 1 evento quando há `pricing`/`conversation`; não registra quando faltam; `conversationId` repetido não gera segunda escrita (via adapter); falha do recorder não impede o `logger.info` nem lança; com `NoopMessagingCostRecorder` o comportamento é idêntico ao atual (só log)
- [x] 5.5 Teste de `env.ts`: defaults de `WHATSAPP_COST_TRACKING_ENABLED` / `WHATSAPP_BILLING_COUNTRY`; `"false"` desliga; país inválido (≠ 2 letras) falha no load

## 6. Consultas de agregação

- [x] 6.1 Criar `src/whatsapp-connectivity/infrastructure/persistence/sqlite-whatsapp-cost-queries.ts` com `sumInRange({from,to})` e agrupamentos `byDay` / `byCategory` / `byLead`, retornando `{ conversations, estimatedCostUsd, costPartial }` (mesmo shape da fonte LLM)
- [x] 6.2 SQL agrupa sempre por `(bucket, category)` e conta conversas; custo aplicado em JS via `priceFor(category, billing_country, occurred_at)` + `costOf` e re-somado no bucket pedido
- [x] 6.3 Intervalo sem eventos → zeros / série vazia sem erro; grupo com categoria/país sem preço → conversas somadas e `costPartial = true`
- [x] 6.4 Testes das agregações com um conjunto fixo de eventos (múltiplos dias, categorias, leads), incluindo o caso de categoria sem preço e o intervalo vazio

## 7. Validação da change

- [x] 7.1 `npx tsc --noEmit`, `npm run lint` e `npm test` verdes
- [x] 7.2 Boot local (`DATABASE_PATH` temporário): processo sobe e `0004_whatsapp_conversation_events` é aplicada; teste de integração cobrindo um evento de status com `pricing`/`conversation` gravando exatamente uma linha (e o segundo status da mesma janela não gravando outra)
- [x] 7.3 `WHATSAPP_COST_TRACKING_ENABLED=false` → `NoopMessagingCostRecorder`: evento de status com `pricing` não gera nenhuma escrita em `whatsapp_conversation_events` (teste de integração + `env.test.ts`)
- [x] 7.4 Atualizar, na sincronização das specs, o `## Purpose` de `openspec/specs/consumption-metrics/spec.md` para remover "A fonte WhatsApp ... é adicionada por uma change posterior" e passar a descrever as duas fontes (LLM + WhatsApp)
- [x] 7.5 `openspec validate add-whatsapp-messaging-cost-tracking --strict` sem erros
