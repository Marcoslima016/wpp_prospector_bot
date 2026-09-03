## Context

Ver `proposal.md — Why`. Estado atual relevante:

- `add-management-api` (arquivada) entregou o plugin `/admin` (`registerAdminRoutes` com
  `prefix: "/admin"`), a sessão de usuário único (`session-guard`), os DTOs zod em
  `src/management/interface/dto/` com `replyWithContract`, e o decorator
  `IndexingConversationRepository` que atualiza a projeção `conversation_index` a cada
  `save()`. Só leitura — nenhum endpoint de escrita existe.
- `Conversation` (`src/conversation-engine/domain/conversation.ts`) só transiciona de
  estado dentro de `applyDecision(decision)`, que exige uma `BotDecision`. Já tem
  `reopenIfEnded()` e o getter `acceptsAutomatedReplies` (`false` em `awaitingHuman`).
- `ConversationTurn` outbound guarda os metadados da decisão que o gerou; a serialização é
  tolerante a campos ausentes (padrão de retrocompat já usado para `recommendedModules` /
  `quotedPlan`).
- `InboundBatchCoordinator` serializa o processamento por lead numa fila de `Promise`
  encadeadas (`enqueue(leadPhone, task)`, privado hoje) e já tem `enqueuePendingBatch(...)`
  como entrada pública para reprocessamento no boot.
- `SendTextMessageUseCase` (`whatsapp-connectivity`) envia texto de sessão via gateway; a
  capability `whatsapp-connectivity` **não** rastreia a janela de 24 h — depende da Cloud
  API para rejeitar fora dela.
- `operational-data-store` fornece a conexão SQLite única (`database`) e o runner de
  migrations forward-only (`0001`..`0004`). Adicionar tabela = nova migration numerada.
- No `main.ts`, o objeto `admin` passado a `buildFastifyServer` é montado **depois** do
  `inboundBatchCoordinator`, então dá para injetar a fila do coordenador nas deps do plugin.

## Goals / Non-Goals

**Goals:**

- Três endpoints de escrita sob `/admin/api` (handoff, resume, mensagem avulsa) que passam
  pelo processo do bot e respeitam a serialização por lead.
- Transições de estado e turno manual como operações de primeira classe do domínio,
  distintas de `applyDecision`.
- `origin` no turno outbound (`bot` | `operator`), retrocompatível, servindo também à change
  `add-outbound-prospecting-trigger`.
- Auditoria append-only mínima das ações de operador.

**Non-Goals:**

- Prospecção inicial / envio de template (`add-outbound-prospecting-trigger`).
- Edição ou remoção de turnos já registrados.
- Autor real da auditoria além do literal `operator` (multiusuário).
- Rastrear o estado da janela de 24 h de forma robusta — o pré-check é uma aproximação
  pelo último inbound (ver D4).
- A UI dessas ações (`add-management-web-ui`).

## Decisions

### D1 — Fila serial por lead compartilhada entre inbound e ações de operador

Extrair a fila encadeada de `InboundBatchCoordinator` para um `LeadSerialQueue`
autônomo (`src/conversation-engine/infrastructure/inbound/lead-serial-queue.ts`):
`run(leadPhone, task): Promise<T>` encadeia `task` após o que já estiver pendente para
aquele lead e resolve com o retorno de `task`. O coordenador passa a usar essa classe por
dentro; o `main.ts` cria **uma** instância e injeta tanto no coordenador quanto no plugin
`/admin`.

O caso de uso das ações roda seu `load → mutate → save → (send)` inteiro dentro de
`queue.run(leadPhone, ...)`. Assim uma ação nunca lê/grava a conversa em paralelo a uma
geração de resposta para o mesmo lead.

**Alternativa:** um `Map<leadPhone, Promise>` novo só para o `/admin`. Rejeitada — seriam
duas filas independentes para o mesmo lead, que voltariam a competir entre si.
**Alternativa:** expor `enqueue` público no coordenador e reusar direto. Rejeitada — mistura
a semântica de "lote de inbound" com "ação avulsa"; a classe extraída é mais honesta e
testável isolada.

### D2 — Transições manuais como métodos do domínio, sem `BotDecision`

`Conversation` ganha:

- `handoffToHuman()` — `state` vai para `awaitingHuman` a partir de `active` ou `ended`;
  no-op se já `awaitingHuman`. Não toca intent/qualificação.
- `resumeFromHuman()` — `state` vai para `active` a partir de `awaitingHuman` ou `ended`;
  no-op se já `active`.
- `recordManualOutboundTurn(text, now)` — empurra um `ConversationTurn.outbound` com
  `origin: "operator"`, sem metadados de decisão (intent/qualificação/módulos herdam o
  padrão vazio já suportado). Não altera `state`.

Distintas de `applyDecision`, que continua a única via para mudanças originadas pelo bot.

**Alternativa:** sintetizar uma `BotDecision` "vazia" para reusar `applyDecision`. Rejeitada
— `applyDecision` também mexe em intent/qualificação/`clearPending` e carrega semântica de
turno do bot; forçar isso num caminho manual é acoplamento espúrio.

### D3 — `origin` no `ConversationTurn` outbound, retrocompatível

`OutboundTurnProps` ganha `origin: "bot" | "operator"`. `ConversationTurn.outbound(...)`
default `"bot"` (todos os call sites atuais são do bot). `toJSON` emite `origin` só para
outbound; `fromJSON` faz `raw.origin ?? "bot"` — mesmo padrão de retrocompat de
`recommendedModules`. `SerializedTurn` ganha `origin?: "bot" | "operator"`.

`Conversation.applyDecision` passa `origin: "bot"` explícito ao criar os turnos (ou confia
no default). O mapper `conversation-detail.mapper.ts` (`add-management-api`) passa a expor
`origin` em cada turno outbound do `ConversationDetail`; o DTO `conversation.dto.ts` ganha
o campo.

### D4 — Guarda da janela de 24 h por pré-check do último inbound + mapeamento da rejeição do gateway

O endpoint de mensagem avulsa considera a janela **aberta** se existe um turno inbound cujo
`timestamp` está a menos de 24 h de `now`. Fechada → `409` com motivo, sem chamar o gateway.
Aberta → chama `SendTextMessageUseCase`; se o gateway rejeitar por janela expirada (erro da
Cloud API), o caso de uso mapeia para `409` com motivo e **não** registra turno.

É uma aproximação (a Cloud API é a autoridade real da janela), mas dá um caminho
determinístico e testável para o caso comum e evita uma chamada certa de falhar. O
mapeamento da rejeição do gateway cobre a divergência.

**Alternativa:** só tentar enviar e traduzir o erro. Rejeitada — perde a checagem barata e
torna todo teste dependente de simular erro de gateway.

### D5 — Auditoria: tabela append-only `admin_action_events` + adapter best-effort

Nova migration `0005_admin_action_events.sql`:

```
CREATE TABLE admin_action_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT NOT NULL,   -- ISO-8601 UTC
  actor       TEXT NOT NULL,   -- literal 'operator' por ora
  action      TEXT NOT NULL,   -- 'handoff' | 'resume' | 'send-message'
  lead_phone  TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE INDEX idx_admin_action_events_occurred_at ON admin_action_events (occurred_at);
CREATE INDEX idx_admin_action_events_lead        ON admin_action_events (lead_phone);
```

Porta `AdminActionAuditPort` (`src/management/application/ports/`) com
`record({ actor, action, leadPhone, occurredAt })`. Adapter
`SqliteAdminActionAudit` (`src/management/infrastructure/persistence/`) faz um `INSERT`.
O caso de uso chama `audit.record(...)` **após** a mutação persistida, dentro de
`try/catch` que loga `warn` e engole o erro — mesma postura best-effort do decorator de
projeção. Sem porta no-op: a tabela existe sempre (migration), então o adapter real é o
único.

### D6 — Caso de uso único de aplicação, três operações

`ConversationActionUseCase` (`src/management/application/`) com `handoff(leadPhone)`,
`resume(leadPhone)`, `sendMessage(leadPhone, text)`. Cada método:

1. `queue.run(leadPhone, async () => { ... })`:
2. `conversation = await repository.load(leadPhone)` → `null` ⇒ lança `ConversationNotFoundError` (rota → 404);
3. muta via método de domínio (D2); para `sendMessage`, checa janela (D4) e chama `SendTextMessageUseCase` antes de `recordManualOutboundTurn`;
4. `await repository.save(conversation)` (o decorator de índice atualiza a projeção de leitura de graça);
5. `audit.record(...)` best-effort (D5);
6. retorna o agregado atualizado (a rota serializa via `conversation-detail.mapper` + `replyWithContract`).

Erros de domínio/gateway viram tipos nomeados; um `setErrorHandler` no escopo do plugin (ou
mapeamento na rota) traduz para 404 / 409 / 422.

### D7 — Rotas no plugin `/admin`, atrás da guarda de sessão

`src/management/infrastructure/http/admin-conversation-actions.routes.ts` registra os três
`POST` sob o mesmo escopo já coberto pelo `preHandler` de sessão em `register-admin-routes.ts`.
As deps novas do plugin (`AdminRoutesDeps`): `sendText: SendTextMessageUseCase`,
`queue: LeadSerialQueue`, `audit: AdminActionAuditPort`, `clock`. O `main.ts` preenche a
partir de instâncias que já existem no boot (`sendTextMessage`, a fila extraída, um
`SqliteAdminActionAudit(database, logger)`).

Contratos: `HandoffResult` / `ResumeResult` reusam `ConversationDetail`; `SendMessageResult`
= `{ sent: true, turn: <outbound turn DTO> }`. Todos no módulo `interface/dto/`, validados
por `replyWithContract` em dev/test.

## Risks / Trade-offs

- **[Pré-check de janela diverge da Cloud API]** (lead escreveu, janela abriu, mas expira no
  intervalo) → o mapeamento da rejeição do gateway para `409` cobre; nunca se registra um
  turno "enviado" sem envio confirmado.
- **[Auditoria best-effort perde uma linha]** num erro de banco → aceitável para um operador
  único; `warn` no log dá rastro. Revisitar se virar requisito de compliance.
- **[Extração da fila do coordenador]** mexe num ponto quente (serialização de inbound) →
  cobrir com os testes já existentes do coordenador + testes novos da `LeadSerialQueue`
  isolada; comportamento observável do inbound não muda.
- **[`origin` em três changes]** (`applyDecision` aqui, `recordProspectingTurn` na de
  prospecção) → o campo e o default de retrocompat são definidos aqui uma vez; a change de
  prospecção só reusa.
- **[Envio manual não muda o estado]** → um operador que quer "assumir e responder" precisa
  chamar `handoff` **e** `messages`. É intencional (cada endpoint faz uma coisa); a UI
  encadeia as duas chamadas.

## Migration Plan

1. Migration `0005_admin_action_events.sql` — aplicada no próximo boot; nada a popular.
2. `main.ts`: extrair a instância única de `LeadSerialQueue`, injetar no coordenador e nas
   deps do plugin `/admin`; construir `SqliteAdminActionAudit`; passar `sendText`/`queue`/
   `audit` em `admin: { ... }`.
3. Sem backfill de dados: turnos outbound antigos são lidos como `origin: "bot"` pelo
   `fromJSON`. Conversas que já receberem um turno manual passam a gravar `origin` no JSON —
   inócuo para leitores antigos (campo ignorado).
4. Rollback: remover o registro das três rotas e as deps novas do plugin; os métodos de
   domínio e a tabela `admin_action_events` ficam inertes. Nenhum dado de conversa em risco
   (a fonte da verdade continua o arquivo por lead).

## Open Questions

- Autor real da auditoria (hoje literal `operator`) — só faz sentido definir junto com
  multiusuário; não afeta specs, abordagem nem tarefas desta change.
