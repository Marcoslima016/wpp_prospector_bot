## Context

Ver `proposal.md — Why`. Estado atual relevante:

- `SendOutboundMessageUseCase` (`src/whatsapp-connectivity/application/use-cases/send-outbound-message.use-case.ts`)
  já envia template via `WhatsAppGatewayPort.sendTemplateMessage` e devolve `{ wamid }`. Em
  `main.ts` ele é só `export const sendOutboundMessage` "para uso manual (QA)", sem rota — o
  comentário no `main.ts` diz explicitamente "esta change ainda não expõe um gatilho HTTP
  para envio outbound".
- `add-management-api` (arquivada) entregou o plugin `/admin` (`registerAdminRoutes`,
  `prefix: "/admin"`), a guarda de sessão de usuário único (todo endpoint sob `/admin/api/`
  exceto `POST /admin/api/session` já é protegido), os DTOs zod em
  `src/management/interface/dto/` com `replyWithContract` (validação em dev/test), e o
  decorator `IndexingConversationRepository` que atualiza a projeção `conversation_index` a
  cada `save()`.
- `add-management-conversation-actions` (arquivada) já entregou: `LeadSerialQueue`
  (`src/conversation-engine/infrastructure/inbound/lead-serial-queue.ts`, instância única no
  `main.ts`, injetada no `InboundBatchCoordinator` e no plugin `/admin`); o `origin` de turno
  outbound (`"bot" | "operator"`) retrocompatível em `ConversationTurn`, com
  `ConversationTurn.manualOutbound(...)` e `Conversation.recordManualOutboundTurn(text, now)`;
  `Conversation.handoffToHuman()` / `resumeFromHuman()`; a porta `AdminActionAuditPort` +
  `SqliteAdminActionAudit` (tabela `admin_action_events`, migration `0005`); o
  `ConversationActionUseCase` rodando `load → mutar → save → audit` dentro de
  `queue.run(leadPhone, ...)`; e o mapeamento de erros de domínio para HTTP no escopo do
  plugin.
- `Conversation` (`src/conversation-engine/domain/conversation.ts`): `static createNew(leadPhone)`
  nasce `active` com `turns: []`; `recordManualOutboundTurn` empurra um turno
  `origin: "operator"` sem tocar `state`/intent/qualificação; `recordInboundTurn` deduplica
  por `messageId`. Persistência = 1 arquivo JSON por lead (`FileConversationRepository`),
  fonte da verdade; `operational-data-store` é índice derivado.
- `operational-data-store`: conexão SQLite única (`node:sqlite`), migrations forward-only
  `0001`..`0005` em `src/shared/persistence/sqlite/migrations/`. Nova tabela = nova migration
  numerada. Postura fail-fast no boot (config, base de conhecimento, migrations).
- `add-whatsapp-messaging-cost-tracking` (arquivada) já captura `pricing`/`conversation` dos
  eventos de status da Meta por `wamid` e grava em `whatsapp_conversation_events`.
- `ManagementEnv` (`src/management/infrastructure/config/env.ts`) é o ponto de configuração do
  `/admin`; `resolveAdminConfig(env)` monta o objeto `admin` passado a `buildFastifyServer`.

## Goals / Non-Goals

**Goals:**

- Dois endpoints de escrita sob `/admin/api` — `POST /admin/api/leads` (cadastro) e
  `POST /admin/api/leads/:leadPhone/prospect` (disparo) — atrás da guarda de sessão.
- Um registro `leads` em SQLite (nova migration) com o telefone E.164, contexto opcional,
  estado de prospecção (`pending | sent | replied | failed`) e o `wamid` do primeiro contato.
- Um caso de uso de aplicação que, sob a fila do lead, valida o lead → envia o template
  configurado via `SendOutboundMessageUseCase` → semeia/atualiza a `Conversation` com um
  turno `origin: "operator"` marcado como primeiro contato → persiste tudo.
- Um método de domínio explícito para o turno de primeiro contato de prospecção, distinto de
  `recordManualOutboundTurn` (marcação de prospecção) e de `applyDecision`.
- Ligar o primeiro inbound de um lead prospectado ao estado `replied`, best-effort, sem
  tocar o caminho quente do webhook.
- Configuração do template de primeiro contato (nome, idioma, mapa de parâmetros) via env,
  validada no boot com a postura fail-fast do projeto.

**Non-Goals:**

- Editor/registro de templates na Meta; escolha dinâmica de template por segmento.
- Disparo em lote / importação CSV — o design deixa o ponto de extensão, mas o núcleo é um a
  um (ver D7).
- Segmentação, agendamento de campanha, cadência de follow-up automático.
- Novo fluxo de cálculo de custo — reusa `add-whatsapp-messaging-cost-tracking` via a
  correlação do `wamid` (D6).
- A UI de prospecção (`add-management-web-ui`).
- Migrar o agregado `Conversation` para SQLite — segue arquivo JSON por lead.

## Decisions

### D1 — `leads` como tabela SQLite nova, projeção derivada e não fonte da verdade da conversa

Migration `0006_leads.sql`:

```
CREATE TABLE leads (
  phone              TEXT PRIMARY KEY,          -- E.164
  display_name       TEXT,
  source             TEXT,
  notes              TEXT,
  prospecting_state  TEXT NOT NULL DEFAULT 'pending',  -- pending|sent|replied|failed
  first_contact_wamid TEXT,
  first_contact_at   TEXT,                      -- ISO-8601 UTC, quando foi para 'sent'
  replied_at         TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX idx_leads_prospecting_state ON leads (prospecting_state);
```

`phone` como PK dá a deduplicação por telefone de graça (`INSERT ... ON CONFLICT(phone) DO
UPDATE` para o re-cadastro). O agregado `Conversation` continua em arquivo JSON; `leads` é um
registro operacional paralelo, igual a `conversation_index` / eventos de consumo.

**Alternativa:** guardar o lead dentro do JSON da conversa. Rejeitada — um lead pode ser
cadastrado antes de existir conversa, e o cadastro/estado de prospecção é consulta de
listagem (índice), não histórico de diálogo.

### D2 — Porta `LeadRepositoryPort` + adapter SQLite

`src/management/application/ports/lead-repository.port.ts`:

```
interface LeadRecord {
  phone: string;
  displayName: string | null;
  source: string | null;
  notes: string | null;
  prospectingState: "pending" | "sent" | "replied" | "failed";
  firstContactWamid: string | null;
  firstContactAt: Date | null;
  repliedAt: Date | null;
}
interface LeadRepositoryPort {
  upsert(input: { phone: string; displayName?: string; source?: string; notes?: string }): Promise<LeadRecord>;
  findByPhone(phone: string): Promise<LeadRecord | null>;
  markProspected(phone: string, wamid: string, at: Date): Promise<void>;
  markFailed(phone: string, at: Date): Promise<void>;
  markReplied(phone: string, at: Date): Promise<void>;
}
```

Adapter `SqliteLeadRepository` (`src/management/infrastructure/persistence/`) recebe
`DatabaseSync` + `Logger`, mesma pegada dos outros adapters SQLite do contexto. `upsert`
preserva `prospecting_state` num re-cadastro (só mexe nos campos de contexto e `updated_at`).

### D3 — Método de domínio `recordProspectingOutboundTurn` no `ConversationTurn`/`Conversation`

O turno de primeiro contato precisa ser distinguível de um turno manual comum (mensagem
avulsa) para a UI e para relatórios. Duas opções de marcação:

- **Escolhida:** um campo `kind?: "manual" | "prospecting"` no turno outbound de origem
  `operator` (default `"manual"`, `toJSON`/`fromJSON` retrocompatíveis no mesmo padrão de
  `origin`). `Conversation.recordProspectingOutboundTurn(templateRef, now)` empurra um turno
  `origin: "operator", kind: "prospecting"` com o texto derivado da referência do template
  (nome + parâmetros renderizados, para o histórico ficar legível), sem tocar `state`
  (a conversa já nasce/permanece `active`).
- **Rejeitada:** reusar `recordManualOutboundTurn` sem marcação. Perde a distinção "primeiro
  contato de prospecção" vs "operador respondeu à mão"; a idempotência do disparo (D5)
  ficaria sem âncora no histórico.

`Conversation.createNew(leadPhone)` já serve para a semeadura — o caso de uso faz
`load ?? createNew` e então `recordProspectingOutboundTurn(...)`.

### D4 — Caso de uso `ProspectLeadUseCase` sob a fila do lead

`src/management/application/prospect-lead.use-case.ts`, deps
`{ leads: LeadRepositoryPort, conversations: ConversationRepositoryPort, queue: LeadSerialQueue,
sendTemplate: SendOutboundMessageUseCase, template: FirstContactTemplateConfig, audit:
AdminActionAuditPort, logger, clock }`.

`prospect(leadPhone, { parameters?, force? })`:

1. valida `leadPhone` E.164 (→ `InvalidLeadPhoneError` → 422);
2. `lead = await leads.findByPhone(leadPhone)` → `null` ⇒ `LeadNotFoundError` → 404;
3. idempotência (D5): se `lead.prospectingState ∈ {sent, replied}` **e** não `force` ⇒
   retorna `{ alreadyProspected: true, lead }` sem enviar;
4. `queue.run(leadPhone, async () => { ... })`:
   a. resolve a `OutboundMessageInput` a partir de `template` + `parameters`; sem template
      configurado ⇒ `FirstContactTemplateNotConfiguredError` (→ 503/500, não chama gateway);
   b. `sent = await sendTemplate.execute(input)` — se o gateway rejeitar ⇒
      `leads.markFailed(leadPhone, now)` e relança `ProspectingGatewayError` (→ 502), **sem**
      semear turno;
   c. `conversation = (await conversations.load(leadPhone)) ?? Conversation.createNew(leadPhone)`;
   d. `conversation.recordProspectingOutboundTurn(templateRef, now)`;
   e. `await conversations.save(conversation)` (o decorator de índice atualiza a projeção);
   f. `await leads.markProspected(leadPhone, sent.wamid, now)`;
5. `audit.record({ actor: "operator", action: "prospect", leadPhone, occurredAt: now })`
   best-effort (try/catch + `warn`, não propaga) — reusa `AdminActionAuditPort` da change de
   ações (novo literal de `action`);
6. retorna `{ wamid, lead: <estado atualizado> }`.

Enviar o template **fora** da fila seria uma chamada de rede segurando o lock; mas semear a
conversa **tem** de ser dentro da fila para não competir com o webhook. Escolha: passo 4
inteiro dentro de `queue.run` — o envio de template para um lead ainda não engajado não
concorre com nada de relevante e mantém o código linear. Se virar gargalo, separar 4a-4b
para fora é trivial.

### D5 — Idempotência por estado do lead + `force`

A âncora da idempotência é `leads.prospecting_state`, não a varredura do histórico:
`sent`/`replied` ⇒ já houve primeiro contato bem-sucedido ⇒ no-op sem `force`. `failed` e
`pending` ⇒ segue o envio (um `failed` "antes do gateway", ex.: template não configurado,
nunca chega a `markFailed`, então continua `pending`; um `failed` do gateway pode ser
re-tentado sem `force` — é uma falha transitória de envio, não um "já prospectado"). `force`
verdadeiro ignora o short-circuit e sempre reenvia + registra novo turno `kind: "prospecting"`.

**Alternativa:** exigir `force` para qualquer redisparo, inclusive após `failed`. Rejeitada —
o caso comum de `failed` é erro transitório da Cloud API; obrigar `force` atrita sem ganho.

### D6 — Correlação do `wamid` com o lead, sem novo fluxo de custo

`leads.first_contact_wamid` guarda o `wamid` do template. `add-whatsapp-messaging-cost-tracking`
já grava os eventos de status/precificação por `wamid` em `whatsapp_conversation_events`. A
atribuição lead↔custo é um `JOIN` por `wamid` no lado da leitura (fora do escopo desta
change; a coluna existir é o que basta). Nada muda no handler de status.

### D7 — Estado `replied` derivado do primeiro inbound, best-effort e desacoplado do webhook

O webhook/`conversation-engine` não conhece `leads`. Para ligar o primeiro inbound ao estado
`replied` sem acoplar o caminho quente:

- **Escolhida:** um observador best-effort no fluxo de persistência da conversa. O decorator
  `IndexingConversationRepository.save()` já roda a cada gravação de conversa; adicionar ali
  (ou num segundo decorator `ProspectingReplyTracker`) a regra: se a conversa tem ≥1 turno
  inbound e existe `lead` com `prospecting_state = 'sent'`, chamar `leads.markReplied`. Erro
  ⇒ `warn` e engole (mesma postura do índice), converge na próxima gravação/boot.
- **Rejeitada:** o `conversation-engine` chamar `leads` diretamente. Fura o isolamento da
  capability (o motor não deve conhecer prospecção) e mexe no caminho quente.
- **Rejeitada:** varredura periódica. Latência alta e job novo para manter.

### D8 — Configuração do template de primeiro contato via env, fail-fast no boot

`ManagementEnv` ganha:

- `PROSPECTING_TEMPLATE_NAME` (string, obrigatória quando `ADMIN_ENABLED=true`);
- `PROSPECTING_TEMPLATE_LANG` (string, default `pt_BR`);
- `PROSPECTING_TEMPLATE_PARAM_KEYS` (CSV opcional — nomes ordenados dos parâmetros aceitos no
  corpo do disparo, para montar o array na ordem que a Meta espera).

`resolveAdminConfig` monta `firstContactTemplate: { name, lang, paramKeys }` e o `main.ts`
injeta no plugin. Sem `PROSPECTING_TEMPLATE_NAME` com `ADMIN_ENABLED=true` ⇒ o boot falha com
mensagem acionável (mesma postura de `ADMIN_ACCESS_SECRET`). Em runtime, se ainda assim o
template chegar vazio ao caso de uso ⇒ `FirstContactTemplateNotConfiguredError` (defesa em
profundidade).

**Alternativa:** tabela de config em SQLite editável pela UI. Rejeitada para o MVP — mais
superfície, e o nome do template muda com baixíssima frequência; env é coerente com o resto
da config do `/admin`.

### D9 — Rotas no plugin `/admin`, mapeamento de erros no escopo já existente

`src/management/infrastructure/http/admin-leads.routes.ts`: `POST /api/leads` (body zod
`{ phone, displayName?, source?, notes? }`) e `POST /api/leads/:leadPhone/prospect` (body zod
`{ parameters?: Record<string,string> | string[], force?: boolean }`). Ambas no escopo já
coberto pelo `preHandler` de sessão em `register-admin-routes.ts`.

Erros nomeados → HTTP, no `setErrorHandler` do escopo do plugin (estendendo o mapa que a
change de ações já criou): `InvalidLeadPhoneError` → 422, `LeadNotFoundError` → 404,
`ProspectingGatewayError` → 502, `FirstContactTemplateNotConfiguredError` → 503.

Contratos em `src/management/interface/dto/`: `LeadResource`
(`{ phone, displayName, source, notes, prospectingState, firstContactAt, repliedAt }`),
`RegisterLeadResult = LeadResource`, `ProspectLeadResult = { wamid: string; alreadyProspected: boolean; lead: LeadResource }`.
Validados por `replyWithContract` em dev/test.

### D10 — Fiação no `main.ts`

`admin` (quando `adminConfig` presente) ganha: `sendTemplate: sendOutboundMessage` (já
existe como export "de QA" — deixa de ser só manual), `leads: new SqliteLeadRepository(database, logger)`,
`firstContactTemplate` (de `resolveAdminConfig`). A instância única de `LeadSerialQueue` e o
`SqliteAdminActionAudit` já são injetados pela change de ações — reusar. O
`ProspectingReplyTracker` (D7) é montado sobre o mesmo `database` e embrulha (ou é chamado
por) o `IndexingConversationRepository` na cadeia de decorators do repositório de conversas.
Os comentários "uso manual / esta change ainda não expõe gatilho HTTP" no `main.ts` saem.

## Risks / Trade-offs

- **[Envio de template segurando o lock da fila do lead]** (D4, passo 4b é rede dentro de
  `queue.run`) → aceitável: um lead recém-cadastrado não tem processamento concorrente
  relevante; se medir latência ruim, mover 4a-4b para fora da fila e manter só a semeadura
  dentro. Não muda specs.
- **[`replied` best-effort perde a transição]** (D7, erro no tracker) → o estado converge na
  próxima gravação da conversa ou no boot; `warn` deixa rastro. Nunca bloqueia o webhook.
- **[Idempotência ancorada no `prospecting_state`, não no histórico]** (D5) → se alguém editar
  `leads` à mão, o disparo pode divergir do que está na conversa. Operador único, risco
  baixo; o turno `kind: "prospecting"` no histórico é a evidência auditável.
- **[Conversa semeada sem inbound entra na projeção de leitura]** → a listagem de
  `/admin/api/conversations` passa a mostrar conversas "só com turno outbound". É desejável
  (o operador quer ver que prospectou), mas os filtros por intent (`unknown`) e a ausência de
  pendência de inbound precisam se comportar — coberto pelos testes da projeção.
- **[`origin`/`kind` em turno tocado por três changes]** → `origin` veio da change de ações;
  esta só acrescenta `kind` no mesmo padrão retrocompatível. Um único ponto de serialização.
- **[Template mal configurado só falha no primeiro disparo]** → mitigado pelo fail-fast no
  boot (D8); a checagem em runtime é defesa em profundidade.
- **[Sem rate limit no disparo]** → um a um pela UI, operador único; o limite de tier da
  Cloud API é a proteção real e já é propagado como erro. Lote/rate limit é extensão futura.

## Migration Plan

1. Migration `0006_leads.sql` — aplicada no próximo boot; nada a popular (nenhum lead
   pré-existente).
2. `ManagementEnv`: adicionar `PROSPECTING_TEMPLATE_NAME` (obrigatória com `ADMIN_ENABLED=true`),
   `PROSPECTING_TEMPLATE_LANG`, `PROSPECTING_TEMPLATE_PARAM_KEYS`. Deploys com `/admin` ligado
   precisam definir `PROSPECTING_TEMPLATE_NAME` **antes** de subir a nova versão, senão o
   boot falha (comportamento desejado, documentar no `.env.example`).
3. `main.ts`: injetar `sendTemplate`, `leads`, `firstContactTemplate` no objeto `admin`;
   montar o `ProspectingReplyTracker` na cadeia de decorators do repositório de conversas;
   remover os comentários/exports "de QA manual" do `sendOutboundMessage` (o export pode
   permanecer, mas deixa de ser a única via).
4. Sem backfill: turnos antigos sem `kind` são lidos como `"manual"` pelo `fromJSON`.
5. Rollback: remover o registro das duas rotas e as deps novas do plugin; a tabela `leads`,
   a migration `0006` e os métodos de domínio ficam inertes. Nenhum dado de conversa em
   risco (fonte da verdade continua o arquivo por lead). As três variáveis de env novas
   podem ficar definidas sem efeito.

## Open Questions

- Formato exato dos parâmetros do template no corpo do disparo (`Record<string,string>`
  nomeado vs array posicional) — ambos mapeáveis via `PROSPECTING_TEMPLATE_PARAM_KEYS`; a
  escolha final é de conveniência da UI e não muniz specs nem tarefas. Assumido: aceitar os
  dois, normalizando para o array posicional que a Meta exige.
- Reconciliação periódica do `prospecting_state` (além do best-effort no `save`) — só vale a
  pena se o tracker best-effort se mostrar insuficiente em produção; não afeta esta change.
