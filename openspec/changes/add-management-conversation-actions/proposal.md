## Why

A `add-management-api` entrega só leitura. O operador precisa **agir** sobre uma conversa a
partir do painel: assumir o atendimento quando o bot não deve mais responder, devolver o
controle ao bot, e mandar uma mensagem escrita à mão dentro da janela de 24 h. Hoje não há
endpoint para nada disso — o estado da conversa só muda como efeito de uma `BotDecision`.

Ver o explore em `docs/explores/explore-ui-dashboard.md` (§1.1).

## What Changes

- **Endpoints de escrita em `/admin/api`** (exigem sessão; toda mutação passa pelo processo
  do bot e respeita a serialização por lead):
  - `POST /admin/api/conversations/:leadPhone/handoff` — marca a conversa como
    `awaitingHuman` (bot para de responder automaticamente).
  - `POST /admin/api/conversations/:leadPhone/resume` — devolve a conversa para `active`
    (bot volta a responder).
  - `POST /admin/api/conversations/:leadPhone/messages` — envia uma mensagem de sessão
    (texto livre) ao lead, delegando ao `SendTextMessageUseCase` existente; registra o
    turno outbound na `Conversation` com marcação de **origem manual** (operador, não bot).
- **Domínio**: `Conversation` ganha operações explícitas de transição manual
  (`handoffToHuman()` / `resumeFromHuman()`) e um `recordManualOutboundTurn(text)` —
  distintas de `applyDecision`, sem exigir uma `BotDecision`. O turno manual é distinguível
  na serialização (novo campo, ex. `origin: "bot" | "operator"`, retrocompatível).
- **Concorrência**: as ações entram na mesma fila por lead do `InboundBatchCoordinator` (ou
  um mutex por lead equivalente) para não colidir com uma geração de resposta em andamento.
- **Auditoria mínima**: cada ação de operador vira uma linha append-only em
  `operational-data-store` (`admin_action_events`: quem — fixo "operator" por ora —, quando,
  qual ação, qual lead).
- **Guardas**: enviar mensagem exige janela de 24 h aberta (senão `409` com motivo);
  `resume` numa conversa `ended` reabre para `active`.

## Capabilities

### New Capabilities
<!-- Nenhuma capability nova: estende `management-api` com o eixo de escrita. -->

### Modified Capabilities
- `management-api`: adiciona **ações de operação sobre conversas** — handoff manual,
  retomada e envio de mensagem avulsa pelo operador, todas autenticadas, serializadas por
  lead e auditadas.
- `conversation-engine`: o requisito **"Ciclo de Vida da Conversa"** passa a admitir
  transições **iniciadas por um operador humano** (para `awaitingHuman` e de volta para
  `active`), além das originadas por `BotDecision`; e o **"Histórico Persistido da
  Conversa"** passa a registrar turnos outbound de **origem manual**, distinguíveis dos
  gerados pelo bot.

## Impact

- **Código**:
  - `src/conversation-engine/domain/conversation.ts` + `conversation-turn.ts` — transições
    manuais, `recordManualOutboundTurn`, campo `origin` retrocompatível em `toJSON/fromJSON`;
  - `src/management/**` (ou onde a `add-management-api` colocou o plugin) — 3 rotas novas +
    validação;
  - novo use-case de aplicação para orquestrar carregar → mutar → salvar → (enviar) sob a
    fila do lead; reaproveita `SendTextMessageUseCase`;
  - adapter `admin_action_events` + migration;
  - `src/main.ts` — fiação.
- **Dependência de change**: `add-management-api` (plugin + sessão + projeção);
  indiretamente `add-embedded-sql-store`.
- **Dados**: `data/conversations/*.json` ganham `origin` nos turnos outbound (default
  `"bot"` na leitura de conversas antigas). Nova tabela `admin_action_events`.
- **Fora de escopo**: prospecção inicial / envio de template (change
  `add-outbound-prospecting-trigger`); edição/remoção de turnos; multiusuário real na
  auditoria; a UI dessas ações (`add-management-web-ui`).
