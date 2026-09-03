<!-- Open Question do design (autor real da auditoria) não afeta o que é construído:
     o autor fica fixo no literal `operator` nesta change. Revisável sem mexer nas specs. -->

## 1. Domínio: origem do turno e transições manuais

- [x] 1.1 `src/conversation-engine/domain/conversation-turn.ts`: adicionar `origin: "bot" | "operator"` a `OutboundTurnProps`; `ConversationTurn.outbound(...)` aceita `origin` com default `"bot"`; expor `readonly origin` no turno; `SerializedTurn` ganha `origin?: "bot" | "operator"`; `toJSON` emite `origin` apenas para outbound; `fromJSON` faz `raw.origin ?? "bot"` (retrocompat)
- [x] 1.2 `src/conversation-engine/domain/conversation.ts`: `applyDecision` cria os turnos outbound com `origin: "bot"` explícito; adicionar `handoffToHuman()` (`state` → `awaitingHuman` a partir de `active`/`ended`, no-op se já `awaitingHuman`; não toca intent/qualificação), `resumeFromHuman()` (`state` → `active` a partir de `awaitingHuman`/`ended`, no-op se já `active`) e `recordManualOutboundTurn(text: string, now?: Date)` (empurra `ConversationTurn.outbound` com `origin: "operator"`, sem metadados de decisão; não altera `state`)
- [x] 1.3 `src/conversation-engine/domain/conversation-turn.test.ts`: `origin` default `"bot"`; round-trip `toJSON`/`fromJSON` preserva `origin: "operator"`; turno outbound serializado sem `origin` volta como `"bot"`
- [x] 1.4 `src/conversation-engine/domain/conversation.test.ts`: `handoffToHuman` de `active` e de `ended` → `awaitingHuman`; idempotente em `awaitingHuman`; `resumeFromHuman` de `awaitingHuman` e de `ended` → `active`; idempotente em `active`; `recordManualOutboundTurn` adiciona turno `origin: "operator"` sem mudar `state` nem intent/qualificação; `acceptsAutomatedReplies` reflete o estado após cada transição

## 2. Migration da auditoria

- [x] 2.1 Criar `src/shared/persistence/sqlite/migrations/0005_admin_action_events.sql` com a tabela do design D5 (`id` PK autoincrement, `occurred_at`, `actor`, `action`, `lead_phone`, `recorded_at`, todos `TEXT NOT NULL` exceto o `id`) e índices em `occurred_at` e `lead_phone`; comentário de cabeçalho no mesmo estilo das migrations `0002`/`0004` (append-only, somente INSERT)
- [x] 2.2 Criar `src/shared/persistence/sqlite/admin-action-events-schema.test.ts`: aplicar `0001`..`0005` em banco `:memory:` e verificar colunas e índices de `admin_action_events`

## 3. Porta e adapter de auditoria

- [x] 3.1 Criar `src/management/application/ports/admin-action-audit.port.ts`: `AdminActionAuditPort` com `record(entry: { actor: string; action: "handoff" | "resume" | "send-message"; leadPhone: string; occurredAt: Date }): Promise<void>`
- [x] 3.2 Criar `src/management/infrastructure/persistence/sqlite-admin-action-audit.ts`: `SqliteAdminActionAudit implements AdminActionAuditPort` — `INSERT` na `admin_action_events` (`occurred_at` = `occurredAt.toISOString()`, `recorded_at` = agora); recebe `DatabaseSync` e `Logger`
- [x] 3.3 Criar `src/management/infrastructure/persistence/sqlite-admin-action-audit.test.ts`: `record` insere uma linha com os campos corretos; múltiplos `record` acumulam linhas (append-only)

## 4. Fila serial por lead compartilhada

- [x] 4.1 Criar `src/conversation-engine/infrastructure/inbound/lead-serial-queue.ts`: `LeadSerialQueue` com `run<T>(leadPhone: string, task: () => Promise<T>): Promise<T>` que encadeia `task` após a última promessa pendente do lead e resolve/rejeita com o resultado de `task`; limpa a entrada do `Map` quando a fila do lead esvazia; `whenSettled()` auxiliar
- [x] 4.2 Refatorar `src/conversation-engine/infrastructure/inbound/inbound-batch-coordinator.ts` para receber e usar uma `LeadSerialQueue` injetada no lugar do `Map<string, Promise<void>>` interno (`enqueue` privado passa a delegar a `queue.run`); comportamento observável do inbound inalterado
- [x] 4.3 Criar `src/conversation-engine/infrastructure/inbound/lead-serial-queue.test.ts`: tarefas do mesmo lead executam em ordem, uma de cada vez; tarefas de leads diferentes podem correr em paralelo; rejeição de uma tarefa não trava as seguintes do mesmo lead; `run` resolve com o retorno da tarefa
- [x] 4.4 Rodar os testes existentes de `inbound-batch-coordinator` e ajustar a montagem (injetar uma `LeadSerialQueue`) sem mudar as asserções de comportamento

## 5. Caso de uso das ações de operação

- [x] 5.1 Criar `src/management/application/errors.ts` (ou reutilizar um módulo de erros existente do contexto): `ConversationNotFoundError`, `SessionWindowClosedError` (carrega motivo), `EmptyMessageTextError`
- [x] 5.2 Criar `src/management/application/conversation-action.use-case.ts`: `ConversationActionUseCase` com deps `{ repository, queue: LeadSerialQueue, sendText: SendTextMessageUseCase, audit: AdminActionAuditPort, logger, clock }` e métodos `handoff(leadPhone)`, `resume(leadPhone)`, `sendMessage(leadPhone, text)` — cada um roda `load → mutar (domínio) → save → audit best-effort` dentro de `queue.run(leadPhone, ...)`, retornando o `Conversation` atualizado; `load` `null` → `ConversationNotFoundError`
- [x] 5.3 `sendMessage`: validar `text` não vazio (→ `EmptyMessageTextError`); pré-check da janela de 24 h pelo turno inbound mais recente vs `clock()` (fechada → `SessionWindowClosedError`); chamar `sendText.execute({ to: leadPhone, text })`; se o gateway rejeitar por janela expirada, traduzir para `SessionWindowClosedError` e não registrar turno; em sucesso `conversation.recordManualOutboundTurn(text, now)` antes do `save`
- [x] 5.4 Auditoria best-effort: `audit.record(...)` após o `save` bem-sucedido, dentro de `try/catch` que loga `warn` e não propaga
- [x] 5.5 Criar `src/management/application/conversation-action.use-case.test.ts` com um repositório em memória e fakes de `sendText`/`audit`/`queue`: handoff de conversa `active` → `awaitingHuman` persistido + auditado; handoff idempotente; resume de `awaitingHuman`/`ended` → `active`; `load` `null` → `ConversationNotFoundError` para os três métodos; `sendMessage` dentro da janela envia + registra turno `origin: "operator"` + audita; texto vazio → `EmptyMessageTextError` sem enviar; último inbound > 24 h → `SessionWindowClosedError` sem enviar; rejeição do gateway por janela → `SessionWindowClosedError` sem turno; falha do `audit.record` é logada e não falha a ação; todas as operações passam por `queue.run` (verificar serialização com uma tarefa concorrente)

## 6. Contratos de resposta das ações

- [x] 6.1 `src/management/interface/dto/conversation.dto.ts`: adicionar `origin: "bot" | "operator"` ao schema do turno outbound do `ConversationDetail`
- [x] 6.2 Criar/gerar em `src/management/interface/dto/` os contratos das ações: `HandoffResult` e `ResumeResult` (reusam `ConversationDetail`), `SendMessageResult` = `{ sent: true; turn: <OutboundTurn DTO> }`; exportar pelo `index.ts` do módulo
- [x] 6.3 `src/management/interface/conversation-detail.mapper.ts`: mapear `origin` de cada turno outbound (default `"bot"` quando ausente no agregado carregado de arquivo antigo)
- [x] 6.4 `src/management/interface/dto/dto.test.ts`: payloads conformes de `HandoffResult`/`ResumeResult`/`SendMessageResult` passam; `origin` fora do enum é rejeitado; `ConversationDetail` sem `origin` no turno é rejeitado pelo schema (o mapper sempre preenche)

## 7. Rotas HTTP e registro no plugin `/admin`

- [x] 7.1 Criar `src/management/infrastructure/http/admin-conversation-actions.routes.ts`: `POST /api/conversations/:leadPhone/handoff`, `.../resume`, `.../messages` (body `{ text }` validado por zod); cada rota chama o método correspondente do `ConversationActionUseCase`, mapeia o agregado via `conversation-detail.mapper` e responde por `replyWithContract`
- [x] 7.2 Mapeamento de erros para HTTP (na rota ou `setErrorHandler` do escopo do plugin): `ConversationNotFoundError` → 404, `SessionWindowClosedError` → 409 com o motivo no corpo, `EmptyMessageTextError` / body inválido → 422; demais erros → 500
- [x] 7.3 `src/management/infrastructure/http/register-admin-routes.ts`: `AdminRoutesDeps` ganha `sendText: SendTextMessageUseCase`, `queue: LeadSerialQueue`, `audit: AdminActionAuditPort`; instanciar `ConversationActionUseCase` e registrar `registerAdminConversationActionsRoutes` no mesmo escopo coberto pela guarda de sessão
- [x] 7.4 Criar `src/management/infrastructure/http/admin-conversation-actions.routes.test.ts` (via `app.inject`, usando o `admin-test-app` de test-support, autenticado): handoff/resume felizes retornam o detalhe com o `state` novo; `messages` dentro da janela retorna `SendMessageResult` e o turno aparece no detalhe com `origin: "operator"`; sem sessão → 401 nos três; telefone inexistente → 404; janela fechada → 409 com motivo; `text` vazio → 422; cada ação bem-sucedida grava linha em `admin_action_events`
- [x] 7.5 Atualizar `src/management/test-support/admin-test-app.ts` (e fakes de test-support) para fornecer as deps novas (`sendText`, `queue`, `audit`) ao plugin nos testes

## 8. Fiação no boot

- [x] 8.1 `src/main.ts`: criar uma única `LeadSerialQueue`; injetá-la em `new InboundBatchCoordinator({ ..., queue })`
- [x] 8.2 `src/main.ts`: quando `adminConfig` presente, construir `new SqliteAdminActionAudit(database, logger)` e passar `sendText: sendTextMessage`, `queue`, `audit` no objeto `admin` de `buildFastifyServer`
- [x] 8.3 Ajustar a tipagem de `admin` em `buildFastifyServer` (`src/whatsapp-connectivity/infrastructure/http/fastify-server.ts`) para os campos novos de `AdminRoutesDeps`
- [x] 8.4 Boot local com `ADMIN_ENABLED=true`: `0005_admin_action_events` aplicada; login → `POST .../handoff` muda o estado (confirmar via `GET /api/conversations/:leadPhone`) → `POST .../resume` volta a `active` → `POST .../messages` (com inbound recente) registra turno `origin: "operator"`; linha correspondente em `admin_action_events`

## 9. Teste de integração e validação

- [x] 9.1 Criar `src/management/conversation-actions.integration.test.ts`: servidor com `admin` + SQLite `:memory:` migrado; via repositório decorado, semear uma conversa `active` com um inbound recente; login → handoff → detalhe mostra `awaitingHuman` → `messages` envia (gateway fake) e detalhe mostra o turno manual → resume → detalhe mostra `active`; sem sessão a cada endpoint → 401; `admin_action_events` tem uma linha por ação
- [x] 9.2 Cobrir no integration test: `messages` com o único inbound além de 24 h → 409 sem turno; conversa inexistente em cada endpoint → 404
- [x] 9.3 `npx tsc --noEmit`, `npm run lint` e `npm test` verdes
- [x] 9.4 `openspec validate add-management-conversation-actions --strict` sem erros
