<!-- Open Questions do design não afetam o que é construído: o formato dos filtros de data
     é aceito como ISO 8601 e o TTL de sessão é fixado em 12 h (ADMIN_SESSION_TTL_MS,
     ajustável por env). Ambos revisáveis sem mexer nas specs. -->

## 1. Dependências e configuração de env

- [x] 1.1 Adicionar `@fastify/cookie` e `@fastify/static` ao `package.json` (deps) e instalar
- [x] 1.2 Criar `src/management/infrastructure/config/env.ts` com schema zod (fail-fast, mesmo padrão dos outros loaders): `ADMIN_ENABLED` (`z.coerce`/string→boolean, default `true`), `ADMIN_ACCESS_SECRET` (`z.string().min(1)`, obrigatório quando `ADMIN_ENABLED`), `ADMIN_SESSION_SECRET` (`z.string().min(1)`, idem), `ADMIN_SESSION_TTL_MS` (`z.coerce.number().int().positive().default(43200000)`), `ADMIN_WEB_DIST_DIR` (`z.string().min(1).default("../wpp_prospector_bot_web/dist")`)
- [x] 1.3 `loadManagementEnv(source = process.env)` exporta `ManagementEnv`; quando `ADMIN_ENABLED` e faltar `ADMIN_ACCESS_SECRET`/`ADMIN_SESSION_SECRET`, o parse falha com mensagem clara (fail-fast no boot). Também exporta `resolveAdminConfig(env)` → segredos não-opcionais ou `null` quando desligada
- [x] 1.4 Atualizar `.env.example` com as novas variáveis e um comentário curto sobre nunca expor `/admin` sem rede fechada
- [x] 1.5 `src/management/infrastructure/config/env.test.ts`: defaults aplicados; `ADMIN_ENABLED=false` dispensa os segredos; `ADMIN_ENABLED=true` sem segredo → erro; `ADMIN_SESSION_TTL_MS` inválido → erro

## 2. Contratos de resposta (DTOs zod)

- [x] 2.1 Criar `src/management/interface/dto/` com schemas zod + tipos inferidos: `ConversationListItem`, `ConversationListPage` (itens + `pageSize` + cursor/próxima página), `ConversationDetail` (turnos, intent, qualificação, módulos, plano citado, flags de pendência e de abandono), `ConsumptionSeries` (linhas por grupo + total, com tokens somados e custo estimado), `Overview` (conversas por estado, total de leads, pendências)
- [x] 2.2 Criar `src/management/interface/dto/query.ts` com schemas de query: paginação (`limit`, `cursor`), filtros de listagem (`state` enum `active|ended|awaitingHuman`, `leadIntent`, `phone` trecho, `activityFrom`/`activityTo` ISO 8601) e de consumo (`from`, `to`, `groupBy` enum `day|lead|model|category`)
- [x] 2.3 Helper `replyWithContract`/`checkContract` (`src/management/infrastructure/http/reply-with-contract.ts`): fora de produção valida o payload contra o schema e lança `ContractViolationError` (→ 500) em divergência; em produção passa direto
- [x] 2.4 Testes dos DTOs: payload conforme passa; payload com campo faltando/tipo errado é sinalizado pelo helper em `test`

## 3. Autenticação de sessão de usuário único

- [x] 3.1 Criar `src/management/infrastructure/http/session-token.ts`: `issue(now, ttlMs, secret)` → cookie `payload.hmac` com `payload` = base64url(`{ iat, exp }`) e `hmac` = HMAC-SHA256(payload, secret) via `node:crypto`; `verify(token, now, secret)` → `ok | invalid-signature | expired`
- [x] 3.2 Testes de `session-token`: round-trip `issue`→`verify` ok; assinatura adulterada → `invalid-signature`; `exp` vencido → `expired`; troca de `secret` invalida token previamente emitido
- [x] 3.3 Criar `src/management/infrastructure/http/admin-session.routes.ts`: `POST /api/session` compara `body.secret` com `ADMIN_ACCESS_SECRET` (comparação de tempo constante) → em sucesso `setCookie("admin_session", issue(...), { httpOnly: true, sameSite: "strict", secure: true, path: "/admin" })`; em falha `401` sem cookie; `DELETE /api/session` → `clearCookie` no mesmo path
- [x] 3.4 Criar `preHandler` de guarda (`session-guard.ts`) para `/api/*` (exceto `POST /api/session`): lê `admin_session`, chama `verify`; `ok` segue, qualquer outro resultado → `401` com corpo neutro
- [x] 3.5 Testes das rotas de sessão + guarda (via `app.inject`): login certo define cookie; login errado → 401; endpoint protegido sem cookie / cookie inválido / expirado → 401; logout expira o cookie e o acesso volta a 401

## 4. Projeção de leitura `conversation_index`

- [x] 4.1 Criar migration `src/shared/persistence/sqlite/migrations/0003_conversation_index.sql` com a tabela do design D3 (`lead_phone` PK, `state`, `lead_intent`, `lead_qualification`, `turn_count`, `last_activity_at`, `has_pending_inbound`, `quoted_plan`, `updated_at`) e índices em `state`, `lead_intent`, `last_activity_at`
- [x] 4.2 Teste da migration: aplicar `0001`..`0003` em banco `:memory:` e verificar colunas e índices de `conversation_index` (`src/shared/persistence/sqlite/conversation-index-schema.test.ts`)
- [x] 4.3 Criar `src/management/infrastructure/persistence/conversation-index-projection.ts`: `upsertFromConversation(conversation)` (deriva os campos do agregado e faz `INSERT ... ON CONFLICT(lead_phone) DO UPDATE`), `rebuildFromDir(conversationsDir)` (varre os JSON uma vez, substitui o conteúdo, transação), `isEmptyOrStale()` (índice vazio → precisa rebuild)
- [x] 4.4 Criar `src/management/infrastructure/persistence/indexing-conversation-repository.ts`: `IndexingConversationRepository implements ConversationRepositoryPort` que embrulha um `ConversationRepositoryPort` real, delega `load`/`save`/`findConversationsWithPendingInbound` e, após `save()` resolver, chama `projection.upsertFromConversation` dentro de `try/catch` que loga `warn` e engole o erro (nunca rejeita o `save`)
- [x] 4.5 Testes de `conversation-index-projection`: `upsertFromConversation` insere e depois atualiza a mesma linha; `rebuildFromDir` popula uma linha por arquivo; campos derivados corretos (state, turn_count, last_activity_at, has_pending_inbound, quoted_plan)
- [x] 4.6 Testes de `IndexingConversationRepository`: `save` delega e atualiza o índice; falha do `upsert` é logada e não propaga; `load`/`findConversationsWithPendingInbound` inalterados; conversa nova passa a ser retornada pelas queries de listagem
- [x] 4.7 Criar `src/management/infrastructure/persistence/conversation-index-queries.ts`: `list({ state?, leadIntent?, phone?, activityFrom?, activityTo?, limit, cursor })` → página ordenada por `last_activity_at` desc + dados de paginação; `overview()` → contagem por `state`, total de leads, contagem `has_pending_inbound = 1`
- [x] 4.8 Testes de `conversation-index-queries` com conjunto fixo: sem filtro (ordem e paginação); filtro por `state`; filtros combinados (`leadIntent` + faixa de data); busca por trecho de telefone; nenhum match → página vazia; `overview` com e sem linhas (zeros)

## 5. Endpoints de leitura de conversas

- [x] 5.1 Criar `src/management/infrastructure/http/admin-conversations.routes.ts`: `GET /api/conversations` valida a query com o schema da tarefa 2.2 (query inválida → 400), chama `conversation-index-queries.list`, mapeia para `ConversationListPage` e responde via `replyWithContract`
- [x] 5.2 `GET /api/conversations/:leadPhone`: chama `repository.load(leadPhone)`; `null` → `404`; senão mapeia o agregado (reusando `Conversation.toJSON()` + mapper) para `ConversationDetail` e responde via `replyWithContract`
- [x] 5.3 Criar o mapper agregado → `ConversationDetail` em `src/management/interface/conversation-detail.mapper.ts` (turnos, intent, qualificação, módulos/assuntos, plano citado, flags de pendência de inbound e de abandono/inatividade)
- [x] 5.4 Testes (via `app.inject`, autenticado): lista default ordenada + paginação; filtro por estado; filtros combinados; busca por telefone; nenhum match → página vazia 200; detalhe de conversa existente com todos os campos; detalhe reflete o arquivo mesmo com índice desatualizado; telefone inexistente → 404

## 6. Endpoints de estatísticas de consumo

- [x] 6.1 Criar `src/management/application/consumption-stats.service.ts` que delega às agregações de `consumption-metrics` (`sqlite-llm-usage-queries` e, quando existir, as de WhatsApp): dado `{ from, to, groupBy }`, retorna `ConsumptionSeries` (linhas por grupo + total, tokens somados, custo estimado)
- [x] 6.2 Tratar tabelas de consumo ausentes: checar `sqlite_master` e devolver série vazia / zeros em vez de propagar
- [x] 6.3 Criar `src/management/infrastructure/http/admin-stats.routes.ts`: `GET /api/stats/consumption` (valida `from`/`to`/`groupBy`, chama o service, `replyWithContract(ConsumptionSeries)`) e `GET /api/stats/overview` (chama `conversation-index-queries.overview`, `replyWithContract(Overview)`)
- [x] 6.4 Testes: `consumption` agrupado por `day` e por `lead|model|category` com dados fixos (total confere); intervalo sem eventos → série vazia 200; sem as tabelas de consumo → série vazia 200; `overview` com linhas e com índice vazio (zeros)

## 7. Servir a interface visual (SPA)

- [x] 7.1 Criar `src/management/infrastructure/http/admin-static.ts` (`applyAdminStatic`, chamado no escopo do plugin `/admin`): se `existsSync(resolve(ADMIN_WEB_DIST_DIR))`, registra `@fastify/static` com `root` no dist e `prefix: "/"`, com fallback SPA (`setNotFoundHandler` devolvendo `index.html` para caminhos GET que não contêm `/api/`); se o diretório não existe, não registra nada e loga `info`
- [x] 7.2 Testes: com um dist temporário, `GET /admin/` serve `index.html` e uma rota de navegação também; sem dist, o boot não falha e `GET /admin/api/stats/overview` (autenticado) responde 200

## 8. Composição do plugin `/admin` e fiação no boot

- [x] 8.1 Criar `src/management/infrastructure/http/register-admin-routes.ts`: plugin Fastify que recebe as deps (`ResolvedAdminConfig`, conexão SQLite, `ConversationRepositoryPort`, logger), registra `@fastify/cookie`, o `preHandler` de guarda, e as rotas de sessão / conversas / stats / estáticos sob o escopo do plugin
- [x] 8.2 Alterar `buildFastifyServer` em `src/whatsapp-connectivity/infrastructure/http/fastify-server.ts` para receber `{ webhook, admin? }` e, quando `admin` presente (o `main.ts` só preenche com `ADMIN_ENABLED`), `app.register(registerAdminRoutes, { prefix: "/admin", ...admin })` ao lado do plugin de webhook; o `addContentTypeParser` do webhook permanece escopado e não afeta `/admin` (regressão coberta em 8.5)
- [x] 8.3 Alterar `src/main.ts`: `loadManagementEnv()` + `resolveAdminConfig()`; quando ligada, embrulhar o `FileConversationRepository` com `IndexingConversationRepository` (a instância embrulhada é a injetada no motor, no sweeper e no coordenador); no boot, se `projection.isEmptyOrStale()`, `await projection.rebuildFromDir(CONVERSATIONS_DIR)`; passar `admin` para `buildFastifyServer`
- [x] 8.4 Quando `ADMIN_ENABLED=false`, `main.ts` usa o `FileConversationRepository` sem decorator e não passa `admin` (nenhuma rota `/admin`, sem custo de projeção) — verificado no boot local (9.4)
- [x] 8.5 Teste de `buildFastifyServer`: sem `admin` nenhuma rota `/admin` existe (404); com `admin` o webhook continua validando assinatura como antes (regressão)

## 9. Teste de integração e validação da change

- [x] 9.1 Criar `src/management/management-api.integration.test.ts`: sobe o servidor com `admin` e um SQLite `:memory:` migrado; fluxo login → `GET /api/conversations` (após `save` de 2 conversas via repositório decorado) → `GET /api/conversations/:leadPhone` → `GET /api/stats/overview` → logout → 401
- [x] 9.2 Cobrir no integration test: acesso sem sessão a cada endpoint protegido → 401; `GET /api/stats/consumption` retorna série vazia quando não há eventos de consumo
- [x] 9.3 `npx tsc --noEmit`, `npm run lint` e `npm test` verdes (276 testes)
- [x] 9.4 Boot local com `ADMIN_ENABLED=true` e segredos definidos: processo sobe, `0003_conversation_index` aplicada, projeção populada a partir de `CONVERSATIONS_DIR` (2 conversas), 401 sem sessão, login + listagem OK; com `ADMIN_ENABLED=false` o boot sobe e `/admin/*` responde 404
- [x] 9.5 `openspec validate add-management-api --strict` sem erros
