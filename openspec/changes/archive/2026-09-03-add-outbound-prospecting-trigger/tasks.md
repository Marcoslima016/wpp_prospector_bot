<!-- Open Questions do design não afetam o que é construído: o formato dos parâmetros do
     template é normalizado para array posicional via `PROSPECTING_TEMPLATE_PARAM_KEYS`
     (aceitando objeto nomeado ou array); a reconciliação periódica do estado fica fora
     desta change. Revisável sem mexer nas specs. -->

## 1. Migration e schema de `leads`

- [x] 1.1 Criar `src/shared/persistence/sqlite/migrations/0006_leads.sql` com a tabela `leads` do design D1 (`phone` PK TEXT E.164, `display_name`, `source`, `notes`, `prospecting_state` TEXT NOT NULL DEFAULT `'pending'`, `first_contact_wamid`, `first_contact_at`, `replied_at`, `created_at` NOT NULL, `updated_at` NOT NULL) e índice `idx_leads_prospecting_state` em `prospecting_state`; comentário de cabeçalho no estilo das migrations `0003`/`0005`
- [x] 1.2 Criar `src/shared/persistence/sqlite/leads-schema.test.ts`: aplicar `0001`..`0006` em banco `:memory:` e verificar colunas, PK e índice de `leads`

## 2. Porta e adapter do repositório de leads

- [x] 2.1 Criar `src/management/application/ports/lead-repository.port.ts`: tipos `LeadRecord` e `LeadRepositoryPort` (`upsert`, `findByPhone`, `markProspected`, `markFailed`, `markReplied`) conforme design D2
- [x] 2.2 Criar `src/management/infrastructure/persistence/sqlite-lead-repository.ts`: `SqliteLeadRepository implements LeadRepositoryPort` recebendo `DatabaseSync` + `Logger`; `upsert` via `INSERT ... ON CONFLICT(phone) DO UPDATE` que preserva `prospecting_state` e só atualiza contexto + `updated_at`; datas gravadas como ISO-8601 UTC; `markProspected` seta `prospecting_state='sent'`, `first_contact_wamid`, `first_contact_at`; `markFailed` seta `'failed'`; `markReplied` seta `'replied'` + `replied_at` apenas quando o estado atual é `'sent'`
- [x] 2.3 Criar `src/management/infrastructure/persistence/sqlite-lead-repository.test.ts`: `upsert` novo → `pending`; `upsert` repetido do mesmo telefone não duplica e mantém o estado; `findByPhone` inexistente → `null`; transições `markProspected`/`markFailed`/`markReplied` refletem no `findByPhone`; `markReplied` é no-op fora de `'sent'`

## 3. Domínio: turno de primeiro contato de prospecção

- [x] 3.1 `src/conversation-engine/domain/conversation-turn.ts`: adicionar `kind?: "manual" | "prospecting"` ao turno outbound de origem `operator` (default `"manual"`); `toJSON` emite `kind` só quando `"prospecting"`; `fromJSON` faz `raw.kind ?? "manual"` (retrocompat, mesmo padrão de `origin`); `SerializedTurn` ganha `kind?: "manual" | "prospecting"`; factory `ConversationTurn.prospectingOutbound({ text, timestamp })` (ou parâmetro `kind` em `manualOutbound`)
- [x] 3.2 `src/conversation-engine/domain/conversation.ts`: adicionar `recordProspectingOutboundTurn(text: string, now?: Date)` que empurra um turno `origin: "operator", kind: "prospecting"` sem alterar `state`, intent ou qualificação
- [x] 3.3 `src/conversation-engine/domain/conversation-turn.test.ts`: `kind` default `"manual"`; round-trip preserva `kind: "prospecting"`; turno serializado sem `kind` volta como `"manual"`
- [x] 3.4 `src/conversation-engine/domain/conversation.test.ts`: `recordProspectingOutboundTurn` em conversa nova (via `createNew`) adiciona um único turno outbound `origin: "operator"`/`kind: "prospecting"`, mantém `state = "active"` e não toca intent/qualificação; em conversa existente apenas acrescenta o turno

## 4. Configuração do template de primeiro contato

- [x] 4.1 `src/management/infrastructure/config/env.ts`: adicionar `PROSPECTING_TEMPLATE_NAME` (string, obrigatória via `superRefine` quando `ADMIN_ENABLED=true`), `PROSPECTING_TEMPLATE_LANG` (string, default `pt_BR`), `PROSPECTING_TEMPLATE_PARAM_KEYS` (CSV opcional → `string[]`)
- [x] 4.2 `resolveAdminConfig(env)`: montar `firstContactTemplate: { name, lang, paramKeys }` no objeto retornado; erro acionável quando `ADMIN_ENABLED=true` e `PROSPECTING_TEMPLATE_NAME` ausente (mesma postura de `ADMIN_ACCESS_SECRET`)
- [x] 4.3 `src/management/infrastructure/config/env.test.ts`: `ADMIN_ENABLED=true` sem `PROSPECTING_TEMPLATE_NAME` → erro de configuração; com o nome definido → `firstContactTemplate` preenchido, `lang` default `pt_BR`, `paramKeys` parseado do CSV
- [x] 4.4 Atualizar `.env.example` (e doc de deploy se houver) com as três variáveis novas e a nota de que o boot falha sem `PROSPECTING_TEMPLATE_NAME`

## 5. Caso de uso `ProspectLeadUseCase`

- [x] 5.1 Criar/estender o módulo de erros de `src/management/application/`: `InvalidLeadPhoneError`, `LeadNotFoundError`, `FirstContactTemplateNotConfiguredError`, `ProspectingGatewayError`
- [x] 5.2 Criar `src/management/application/register-lead.use-case.ts`: `RegisterLeadUseCase` com dep `{ leads: LeadRepositoryPort, clock }`; valida `phone` E.164 (→ `InvalidLeadPhoneError`); `leads.upsert(...)`; retorna o `LeadRecord`
- [x] 5.3 Criar `src/management/application/prospect-lead.use-case.ts`: `ProspectLeadUseCase` com deps do design D4 (`leads`, `conversations`, `queue: LeadSerialQueue`, `sendTemplate: SendOutboundMessageUseCase`, `template: FirstContactTemplateConfig`, `audit: AdminActionAuditPort`, `logger`, `clock`); `prospect(leadPhone, { parameters?, force? })`
- [x] 5.4 `prospect`: validar E.164 → `InvalidLeadPhoneError`; `leads.findByPhone` `null` → `LeadNotFoundError`; short-circuit de idempotência (D5): estado `sent`/`replied` e não `force` → retorna `{ wamid: null, alreadyProspected: true, lead }` sem enviar
- [x] 5.5 `prospect` dentro de `queue.run(leadPhone, ...)`: resolver `OutboundMessageInput` de `template` + `parameters` (normalizar objeto nomeado → array posicional por `paramKeys`); template ausente/vazio → `FirstContactTemplateNotConfiguredError` sem chamar o gateway; `sendTemplate.execute(input)`; rejeição do gateway → `leads.markFailed(leadPhone, now)` + `ProspectingGatewayError` **sem** semear turno
- [x] 5.6 `prospect` em sucesso do envio: `conversation = (await conversations.load(leadPhone)) ?? Conversation.createNew(leadPhone)`; `conversation.recordProspectingOutboundTurn(renderedText, now)`; `conversations.save(conversation)`; `leads.markProspected(leadPhone, sent.wamid, now)`; retorna `{ wamid, alreadyProspected: false, lead }`
- [x] 5.7 `prospect`: `audit.record({ actor: "operator", action: "prospect", leadPhone, occurredAt: now })` após o `save`, em `try/catch` que loga `warn` e não propaga
- [x] 5.8 Criar `src/management/application/register-lead.use-case.test.ts`: lead novo → `pending`; re-cadastro não duplica e preserva estado; telefone não-E.164 → `InvalidLeadPhoneError`
- [x] 5.9 Criar `src/management/application/prospect-lead.use-case.test.ts` com repositórios em memória e fakes de `sendTemplate`/`audit`/`queue`: disparo feliz envia template + semeia conversa com turno `origin: "operator"`/`kind: "prospecting"` + `markProspected` + auditoria; lead inexistente → `LeadNotFoundError`; template não configurado → `FirstContactTemplateNotConfiguredError` sem chamar gateway e sem mudar estado; rejeição do gateway → `ProspectingGatewayError` + `markFailed` + nenhum turno; idempotente sem `force` para `sent`/`replied`; `force` reenvia e adiciona novo turno; `failed` redisparável sem `force`; conversa já existente recebe só o turno acrescido; falha do `audit.record` é logada e não falha a ação; a semeadura ocorre dentro de `queue.run` (verificar com tarefa concorrente)

## 6. Rastreio do estado `replied` a partir do primeiro inbound

- [x] 6.1 Criar `src/management/infrastructure/persistence/prospecting-reply-tracker.ts`: decorator/observador de `ConversationRepositoryPort` que, após `save(conversation)`, se a conversa tem ≥1 turno inbound, chama `leads.markReplied(leadPhone, now)` (no-op fora de `'sent'` — D7); erro → `warn` no logger, engolido
- [x] 6.2 Criar `src/management/infrastructure/persistence/prospecting-reply-tracker.test.ts`: conversa com lead em `sent` e primeiro inbound → `markReplied` chamado; sem turno inbound → não chama; lead ausente ou fora de `'sent'` → no-op; erro do `leads.markReplied` é logado e não propaga (o `save` conclui)
- [x] 6.3 Confirmar a ordem na cadeia de decorators do repositório de conversas (o `save` da fonte da verdade e a atualização do índice acontecem; o tracker roda depois/junto sem quebrar nenhum)

## 7. Contratos de resposta (DTOs)

- [x] 7.1 `src/management/interface/dto/`: `LeadResource` (`phone`, `displayName`, `source`, `notes`, `prospectingState`, `firstContactAt`, `repliedAt`), `RegisterLeadResult = LeadResource`, `ProspectLeadResult = { wamid: string | null; alreadyProspected: boolean; lead: LeadResource }`; exportar pelo `index.ts` do módulo
- [x] 7.2 `src/management/interface/dto/`: se o turno outbound do `ConversationDetail` for exposto, adicionar `kind: "manual" | "prospecting"` ao schema do turno e mapear no `conversation-detail.mapper.ts` (default `"manual"` quando ausente)
- [x] 7.3 Criar mapper `lead.mapper.ts` (`LeadRecord` → `LeadResource`) em `src/management/interface/`
- [x] 7.4 `src/management/interface/dto/dto.test.ts`: payloads conformes de `RegisterLeadResult`/`ProspectLeadResult` passam; `prospectingState` fora do enum é rejeitado; `ProspectLeadResult` com `wamid: null` e `alreadyProspected: true` é válido

## 8. Rotas HTTP e registro no plugin `/admin`

- [x] 8.1 Criar `src/management/infrastructure/http/admin-leads.routes.ts`: `POST /api/leads` (body zod `{ phone, displayName?, source?, notes? }`) → `RegisterLeadUseCase`; `POST /api/leads/:leadPhone/prospect` (body zod `{ parameters?: Record<string,string> | string[], force?: boolean }`) → `ProspectLeadUseCase`; respostas via `conversation`/`lead` mappers + `replyWithContract`
- [x] 8.2 Mapeamento de erros para HTTP (estendendo o `setErrorHandler`/mapa do escopo do plugin da change de ações): `InvalidLeadPhoneError` → 422, `LeadNotFoundError` → 404, `ProspectingGatewayError` → 502, `FirstContactTemplateNotConfiguredError` → 503, body inválido → 422
- [x] 8.3 `src/management/infrastructure/http/register-admin-routes.ts`: `AdminRoutesDeps` ganha `leads: LeadRepositoryPort`, `sendTemplate: SendOutboundMessageUseCase`, `firstContactTemplate: FirstContactTemplateConfig` (reusa `queue` e `audit` já injetados); instanciar `RegisterLeadUseCase` + `ProspectLeadUseCase` e registrar `registerAdminLeadsRoutes` no mesmo escopo coberto pela guarda de sessão
- [x] 8.4 Criar `src/management/infrastructure/http/admin-leads.routes.test.ts` (via `app.inject`, autenticado com o `admin-test-app`): cadastro feliz → `RegisterLeadResult` com `prospectingState: "pending"`; cadastro duplicado não duplica; `phone` inválido → 422; disparo feliz → `ProspectLeadResult` com `wamid` e a conversa passa a existir com o turno `kind: "prospecting"`; lead inexistente → 404; sem sessão nos dois → 401; template não configurado → 503; gateway rejeita → 502 e lead em `failed`; redisparo sem `force` → `alreadyProspected: true` sem novo turno; cada ação bem-sucedida grava linha `action: "prospect"` em `admin_action_events`
- [x] 8.5 Atualizar `src/management/test-support/admin-test-app.ts` e fakes de test-support para fornecer `leads`, `sendTemplate`, `firstContactTemplate` ao plugin nos testes

## 9. Fiação no boot

- [x] 9.1 `src/main.ts`: injetar no objeto `admin` de `buildFastifyServer` — `sendTemplate: sendOutboundMessage`, `leads: new SqliteLeadRepository(database, logger)`, `firstContactTemplate` (de `resolveAdminConfig`); reusar a `LeadSerialQueue` única e o `SqliteAdminActionAudit` já criados
- [x] 9.2 `src/main.ts`: montar o `ProspectingReplyTracker` na cadeia de decorators do repositório de conversas (sobre/junto ao `IndexingConversationRepository`), com o mesmo `database` e `logger`
- [x] 9.3 `src/main.ts`: remover os comentários "uso manual / esta change ainda não expõe um gatilho HTTP para envio outbound" do `sendOutboundMessage`/`sendTextMessage`
- [x] 9.4 Ajustar a tipagem de `admin` em `buildFastifyServer` (`src/whatsapp-connectivity/infrastructure/http/fastify-server.ts`) para os campos novos de `AdminRoutesDeps`
- [x] 9.5 Boot local com `ADMIN_ENABLED=true` e `PROSPECTING_TEMPLATE_NAME` definido: `0006_leads` aplicada; login → `POST /admin/api/leads` cria lead `pending` → `POST /admin/api/leads/:phone/prospect` envia template (gateway real/fake), a conversa aparece em `GET /admin/api/conversations/:phone` com o turno `kind: "prospecting"`, o lead vai a `sent`; simular inbound do lead → estado vai a `replied`; linha `action: "prospect"` em `admin_action_events`

## 10. Teste de integração e validação

- [x] 10.1 Criar `src/management/outbound-prospecting.integration.test.ts`: servidor com `admin` + SQLite `:memory:` migrado + gateway de template fake; login → cadastro → disparo → detalhe da conversa mostra o turno de primeiro contato → simular `save` de conversa com inbound → `leads` mostra `replied`; sem sessão em cada endpoint → 401
- [x] 10.2 Cobrir no integration test: template não configurado → 503; gateway rejeita → 502 + lead `failed` + nenhuma conversa semeada; redisparo sem `force` → no-op; `force` → novo turno; lead inexistente no disparo → 404
- [x] 10.3 `npx tsc --noEmit`, `npm run lint` e `npm test` verdes
- [x] 10.4 `openspec validate add-outbound-prospecting-trigger --strict` sem erros
