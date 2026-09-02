## 1. Contrato da port de LLM (`usage` em `LlmResponse`)

- [x] 1.1 Adicionar `LlmUsage` (`model`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `requestId?`) e tornar `LlmResponse` = `{ text: string; usage: LlmUsage }` em `src/conversation-engine/application/ports/llm-client.port.ts`
- [x] 1.2 `AnthropicLlmClient.generate()` mapeia `message.usage`/`message.model` para `LlmUsage`, coage `cache_read_input_tokens`/`cache_creation_input_tokens` `null` → `0`, e lê o `request-id` do campo `message._request_id` anexado pelo SDK à resposta (fallback: `requestId` omitido). Optou-se por `_request_id` em vez de `.withResponse()` (ambos previstos no design D1) para não quebrar os mocks de SDK existentes
- [x] 1.3 Atualizar `anthropic-llm-client.test.ts`: asserts de mapeamento de `usage` (mapeamento completo com `_request_id`; contadores de cache `null` → `0` e `requestId` omitido sem `_request_id`; `model` do pedido e `usage` zerado quando a resposta não os traz)
- [x] 1.4 Criar helper de teste `fakeLlmResponse(text, partialUsage?)` (`src/conversation-engine/application/ports/llm-client.fake.ts`) e atualizar os fakes de `LlmClientPort` (`generate-reply.use-case.test.ts`, `lexical-retrieval.business-context.test.ts`) para devolver `usage`
- [x] 1.5 `npx tsc --noEmit` + suíte de testes verdes após a mudança BREAKING

## 2. Port e adapters de registro de consumo

- [x] 2.1 Criar `src/conversation-engine/application/ports/usage-recorder.port.ts` com `LlmCallType`, `LlmUsageEvent` (`occurredAt`, `callType`, `leadPhone?`, `usage`) e `UsageRecorderPort.recordLlmCall(event): Promise<void>`
- [x] 2.2 Criar `NoopUsageRecorder` (resolve imediatamente) — usado quando o tracking está desligado
- [x] 2.3 Criar migration `src/shared/persistence/sqlite/migrations/0002_llm_usage_events.sql` com a tabela append-only e os índices (`occurred_at`, `lead_phone`, `model`) conforme design D4
- [x] 2.4 Teste da migration: aplicar `0001`+`0002` em banco `:memory:` e verificar colunas, defaults e índices de `llm_usage_events`
- [x] 2.5 Criar `SqliteUsageRecorder` (recebe a conexão injetada) cujo `recordLlmCall` faz um único `INSERT`, envolve em `try/catch`, loga `warn` no erro e nunca rejeita; grava `price_version = PRICE_TABLE_VERSION` e `recorded_at`
- [x] 2.6 Testes do `SqliteUsageRecorder`: linha gravada com/sem `leadPhone`, com/sem `requestId`; erro de escrita é engolido e logado (não rejeita)

## 3. Tabela de preços versionada e custo

- [x] 3.1 Criar `src/conversation-engine/infrastructure/pricing/anthropic-prices.ts` com `ModelPrice`, `PRICE_TABLE_VERSION`, `ANTHROPIC_PRICES` (Sonnet, Haiku e os modelos usados por default), `priceFor(model, onDate)` e `costOf(tokens, price)`
- [x] 3.2 Preencher os valores US$/MTok por tipo de token a partir da página de preços vigente da Anthropic, cada entrada com `effectiveFrom`
- [x] 3.3 Testes: `priceFor` escolhe a entrada de maior `effectiveFrom` ≤ data; modelo desconhecido → `undefined`; `costOf` soma por tipo de token; custo indisponível quando sem preço

## 4. Fiação (best-effort, sem alterar o fluxo)

- [x] 4.1 Adicionar `LLM_USAGE_TRACKING_ENABLED` (default `true`) ao schema zod em `src/conversation-engine/infrastructure/config/env.ts` e ao `.env.example`
- [x] 4.2 `GenerateReplyUseCase`: receber `usageRecorder: UsageRecorderPort` nas deps; após cada `interpretOnce` bem-sucedido, registrar `callType: "reply-generation"` com o `leadPhone` do parâmetro, fora do await crítico (`void ...catch(()=>{})`)
- [x] 4.3 `LexicalRetrievalBusinessContext`: receber `usageRecorder` no config; após a chamada #1 (extração) retornar, registrar `callType: "signal-extraction"` com o `leadPhone` de `input.conversation`, sem afetar o fallback local nem o retorno
- [x] 4.4 `src/main.ts`: construir `SqliteUsageRecorder(database)` quando `LLM_USAGE_TRACKING_ENABLED`, senão `NoopUsageRecorder`; injetar em `GenerateReplyUseCase` e `LexicalRetrievalBusinessContext`
- [x] 4.5 Testes de `GenerateReplyUseCase`: registra 1 evento por chamada bem-sucedida (2 quando há retry); falha do recorder não impede decisão/`save`/envio; com `NoopUsageRecorder` o fluxo é idêntico ao atual
- [x] 4.6 Testes de `LexicalRetrievalBusinessContext`: registra `signal-extraction` no sucesso da #1; não registra quando a #1 lança (fallback local); falha do recorder não quebra `getContext`

## 5. Consultas de agregação

- [x] 5.1 Criar o módulo de agregação (`sqlite-llm-usage-queries.ts`) com `sumInRange({from,to})` e agrupamentos `byDay` / `byLead` / `byModel` / `byCallType`, retornando contadores de token e custo estimado
- [x] 5.2 SQL agrupa sempre por `(bucket, model)` e soma tokens; custo aplicado em JS via `priceFor`/`costOf` e re-somado no bucket pedido
- [x] 5.3 Intervalo sem eventos → zeros / série vazia sem erro; modelo sem preço → tokens somados e custo do grupo marcado como parcial/indisponível
- [x] 5.4 Testes das agregações com um conjunto fixo de eventos (múltiplos dias, leads, modelos, `callType`), incluindo o caso de modelo sem preço e o intervalo vazio

## 6. Validação da change

- [x] 6.1 `npx tsc --noEmit` (não há script `typecheck`), `npm run lint` e `npm test` verdes (196 testes)
- [x] 6.2 Boot local (`DATABASE_PATH` temporário) verificado: processo sobe e `0002_llm_usage_events` é aplicada. Turno end-to-end gravando 2 linhas coberto pelo teste de integração `infrastructure/llm-usage-tracking.integration.test.ts`
- [x] 6.3 `LLM_USAGE_TRACKING_ENABLED=false` → `NoopUsageRecorder`: turno sem nenhuma escrita em `llm_usage_events` (teste de integração + `env.test.ts`)
- [x] 6.4 `openspec validate add-llm-usage-tracking --strict` sem erros
