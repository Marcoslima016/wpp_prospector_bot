## Context

Ver `proposal.md — Why`. Estado atual relevante:

- Servidor: `buildFastifyServer(deps)` registra **um** plugin (`registerWhatsappWebhookRoutes`).
  O plugin usa `addContentTypeParser` próprio (corpo bruto p/ HMAC) — escopado ao plugin,
  então um segundo plugin com parsing JSON normal convive sem conflito.
- `FileConversationRepository` é a fonte da verdade das conversas (1 JSON por lead). Tem
  `load`, `save`, `findConversationsWithPendingInbound`. Não há índice, busca nem paginação.
- `InboundBatchCoordinator` serializa o processamento por lead (janela de rajada de 8 s).
- `add-embedded-sql-store` fornece a conexão SQLite e o runner de migrations.
- `consumption-metrics` (changes de tracking) fornece tabelas de eventos append-only e
  consultas de agregação.
- Config por zod, fail-fast, dois loaders de env.

## Goals / Non-Goals

**Goals:**

- API de leitura suficiente para as telas 1–3 da UI: sessão, lista/detalhe de conversas,
  estatísticas de consumo, contadores do "agora".
- Não acoplar o motor de conversas à API: a projeção de leitura observa o repositório sem
  que o motor "saiba" que ela existe.
- Isolamento claro entre o webhook público e a superfície `/admin`.
- Contratos de resposta tipados e reutilizáveis pelo front.

**Non-Goals:**

- Qualquer endpoint de escrita (change `add-management-conversation-actions`).
- Multiusuário, papéis, refresh token, expiração deslizante sofisticada.
- SSE / push (o cliente faz polling).
- Reconstrução incremental da projeção por diff — no boot é varredura completa.

## Decisions

### D1 — Segundo plugin Fastify sob `/admin`, no mesmo processo

`buildFastifyServer` passa a registrar também `registerAdminRoutes` com `prefix: "/admin"`.
Um processo, dois plugins isolados. Motivo: só o processo do bot enxerga estado vivo e
respeita a serialização por lead — um serviço separado teria que chamar de volta este
processo para qualquer escrita (e escrita chega na próxima change).

`ADMIN_ENABLED` (default `true`) permite desligar toda a superfície `/admin` num deploy que
só queira o webhook.

**Alternativa:** app/servidor separado desde já. Rejeitada — ver explore §1 (Opção B colapsa
em A assim que há escrita).

### D2 — Auth: segredo compartilhado → cookie de sessão assinado (HMAC), sem lib de sessão

- `POST /admin/api/session` recebe `{ secret }`; se `=== ADMIN_ACCESS_SECRET`, emite cookie
  `admin_session` = `payload.hmac`, onde `payload` = `{ iat, exp }` (base64url) e `hmac` =
  HMAC-SHA256(payload, `ADMIN_SESSION_SECRET`). `HttpOnly`, `SameSite=Strict`, `Secure`,
  `Path=/admin`.
- `preHandler` em `/admin/api/*` (menos `POST /admin/api/session`) valida assinatura e `exp`.
- `DELETE /admin/api/session` expira o cookie.
- TTL fixo (ex. 12 h); re-login ao expirar. Sem store de sessão (stateless, cabe em 1
  usuário).

`@fastify/cookie` para ler/escrever o header; HMAC com `node:crypto`. Sem
`@fastify/session`/`@fastify/jwt` — é mais peça do que o problema exige.

**Risco:** sem revogação antes do `exp`. Aceitável para 1 operador; trocar
`ADMIN_SESSION_SECRET` invalida todas as sessões (válvula de emergência).

### D3 — Projeção `conversation_index` via decorator do repositório, materializada no boot

Nova tabela (migration desta change):

```
conversation_index(
  lead_phone TEXT PRIMARY KEY,
  state TEXT, lead_intent TEXT, lead_qualification TEXT,
  turn_count INTEGER, last_activity_at TEXT,
  has_pending_inbound INTEGER, quoted_plan TEXT,
  updated_at TEXT
)
```

- **Decorator** `IndexingConversationRepository implements ConversationRepositoryPort` que
  embrulha `FileConversationRepository`: delega tudo e, após `save()` bem-sucedido, faz
  `UPSERT` na projeção a partir do agregado salvo. O motor continua recebendo um
  `ConversationRepositoryPort` — não sabe da projeção.
- **Boot**: se a projeção estiver vazia ou marcada como stale, varre `CONVERSATIONS_DIR`
  uma vez e popula. Barato no volume atual; reavaliar se passar de dezenas de milhares.
- Falha ao atualizar a projeção **não** falha o `save()` (best-effort + log): a fonte da
  verdade é o arquivo; a projeção reconstrói no próximo boot.

**Alternativa:** ler todos os JSON a cada `GET /conversations`. Rejeitada — não pagina nem
filtra bem e degrada linearmente. **Alternativa:** hook/evento no domínio. Rejeitada —
acopla o motor à feature de gestão.

### D4 — Detalhe da conversa vem do arquivo, não da projeção

`GET /admin/api/conversations/:leadPhone` chama `repository.load()` e serializa o agregado
(reusa `Conversation.toJSON()` + um mapper para o DTO). A projeção serve **só** a
lista/filtro/paginação e os contadores. Evita duplicar todo o histórico de turnos no SQLite.

### D5 — DTOs com zod, um módulo de contrato

`src/management/interface/dto/*.ts` com schemas zod + tipos inferidos para
`ConversationListItem`, `ConversationDetail`, `ConsumptionSeries`, `Overview`. A change de UI
decide se importa esse módulo direto (workspace) ou gera tipos. Respostas validadas na
saída em dev/test.

### D6 — Endpoints de consumo delegam às agregações de `consumption-metrics`

`GET /admin/api/stats/consumption?from&to&groupBy` chama as funções de agregação expostas
pelas changes de tracking. Se essas changes ainda não existirem no deploy, o endpoint
responde série vazia / zeros (feature-flag implícito pela ausência das tabelas — tratar
"tabela não existe" como "sem dados").

### D7 — Servir a SPA

`@fastify/static` em `root = applications/wpp_prospector_bot_web/dist`, montado em `/admin`,
**só se o diretório existir** (checagem no boot). Fallback SPA (`index.html` para rotas não
`/admin/api/*`). Assim esta change não depende do build do front existir.

## Risks / Trade-offs

- **[Projeção diverge do arquivo]** (crash entre `rename` e `UPSERT`) → reconstrução no
  boot; endpoint/admin task de "reindexar" pode vir depois se necessário.
- **[`/admin` exposto sem rede fechada]** → o gate de sessão é o mínimo; README/deploy
  recomendam Tailscale/allowlist (explore §1.5). `Secure` no cookie exige HTTPS — ok atrás
  do Caddy.
- **[Novo diretório `src/management/`]** → seguir a mesma divisão Clean Arch dos outros
  contextos; review para não virar catch-all.
- **[Custo de varredura no boot]** cresce com o nº de conversas → aceitável agora; medir e,
  se doer, persistir um marcador de "última projeção ok" + só reprocessar arquivos com
  `mtime` maior.

## Migration Plan

1. Migration cria `conversation_index`. Primeiro boot com a feature: varredura popula a
   projeção a partir dos JSON existentes.
2. `main.ts` embrulha o repositório com o decorator e registra o plugin `/admin`.
3. Rollback: remover o registro do plugin e o decorator; `conversation_index` fica órfã
   (inócua) ou é dropada por migration reversa manual. Nenhum dado de conversa em risco (a
   fonte é o arquivo).
4. Deploy: definir `ADMIN_ACCESS_SECRET` e `ADMIN_SESSION_SECRET` (SSM). Sem eles e com
   `ADMIN_ENABLED=true`, o boot falha (fail-fast de env).

## Open Questions

- Router do front e formato exato dos filtros de data (ISO vs epoch) — não afeta o desenho
  do backend; alinhar quando a change de UI começar.
- TTL da sessão (12 h proposto) — ajustável sem mexer em specs.
