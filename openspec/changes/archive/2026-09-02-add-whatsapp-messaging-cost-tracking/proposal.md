## Why

A Meta cobra o WhatsApp por **conversa de 24 h** (categorizada como marketing, utility,
service ou authentication), não por mensagem. Essa informação chega nos eventos de status
do webhook (`statuses[].pricing` e `statuses[].conversation`), mas hoje o
`webhook-event.schema.ts` **nem lê esses campos** e o `HandleMessageStatusUpdateUseCase`
só faz `logger.info`. Sem isso, a metade "WhatsApp" das estatísticas de consumo do painel
de gestão não tem dado de origem.

Ver o explore em `docs/explores/explore-ui-dashboard.md` (§1.2, §1.6).

## What Changes

- **Schema do webhook estendido**: `webhookStatusSchema` passa a aceitar (opcionais)
  `pricing` (`billable`, `pricing_model`, `category`) e `conversation` (`id`,
  `origin.type`, `expiration_timestamp`). Campos ausentes/desconhecidos não derrubam o
  parsing — mesma postura tolerante atual.
- **Novo port `MessagingCostRecorderPort`** com adapter que grava em
  `operational-data-store` (tabela **append-only** `whatsapp_conversation_events`, uma linha
  por combinação `conversationId` + evento de precificação). Deduplicação por
  `conversationId` para não contar a mesma janela de 24 h várias vezes.
- **Atribuição**: `timestamp`, `recipientId` (lead), `conversationId`, `category`,
  `originType`, `pricingModel`, `billable`, `expirationTimestamp`.
- **`HandleMessageStatusUpdateUseCase`** passa a extrair esses campos e chamar o recorder
  (best-effort — falha ao registrar não afeta o `200` rápido do webhook).
- **Estimativa de custo**: tabela de preços da Meta por categoria/país **versionada em
  código** (o preço varia por país do destinatário — assumir um país-base configurável no
  MVP, refinar depois). Custo derivado na agregação.
- **Consultas de agregação**: conversas e custo por dia / categoria / lead num intervalo —
  base para os endpoints da `add-management-api`, no mesmo formato das métricas de LLM.

## Capabilities

### New Capabilities
<!-- Nenhuma capability nova: estende `consumption-metrics`, introduzida em
     add-llm-usage-tracking, com a fonte WhatsApp. -->

### Modified Capabilities
- `consumption-metrics`: adiciona a **fonte WhatsApp** — registro append-only de conversas
  de 24 h da Cloud API (categoria, origem, precificação) e agregação de custo de mensageria
  por período, ao lado das métricas de LLM já existentes.
- `whatsapp-connectivity`: o requisito **"Recebimento de Atualização de Status"** passa a
  extrair e registrar os dados de precificação/conversa presentes no evento de status; o
  registro é best-effort e não altera a confirmação rápida de recebimento nem o
  comportamento atual de log.

## Impact

- **Código**:
  - `src/whatsapp-connectivity/infrastructure/webhook/webhook-event.schema.ts` — campos
    `pricing`/`conversation` no status + tipos;
  - `src/whatsapp-connectivity/domain/message-status-update.ts` — carregar os novos dados
    (ou um novo VO `WhatsappConversationBilling`);
  - `src/whatsapp-connectivity/application/use-cases/handle-message-status-update.use-case.ts`
    — extrair e registrar;
  - novo `application/ports/messaging-cost-recorder.port.ts` + adapter SQLite + migration
    `whatsapp_conversation_events`;
  - nova tabela de preços Meta versionada;
  - `src/main.ts` — fiação do recorder na use-case de status.
- **Dependência de change**: `add-embedded-sql-store`; compartilha a capability
  `consumption-metrics` com `add-llm-usage-tracking` (independente dela — pode ser feita
  antes ou depois, mas a spec de `consumption-metrics` precisa existir).
- **Dados**: nova tabela `whatsapp_conversation_events` (append-only). Mesma política de
  retenção das métricas de LLM.
- **Fora de escopo**: reconciliação com a fatura real da Meta / API de billing; preço por
  país além do país-base; qualquer endpoint HTTP ou UI.
