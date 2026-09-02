## Why

O bot é de **prospecção** — mas hoje ele só reage a mensagens que chegam. Não há como
iniciar o contato: `SendOutboundMessageUseCase` (template) e `SendTextMessageUseCase`
existem, mas o `main.ts` os expõe apenas como export para QA manual, sem gatilho HTTP e sem
criar a `Conversation` correspondente. O painel de gestão precisa ser o lugar onde o
operador cadastra leads e dispara a primeira mensagem.

Ver o explore em `docs/explores/explore-ui-dashboard.md` (§1.1) e o comentário em `main.ts`
("esta change ainda não expõe um gatilho HTTP para envio outbound").

## What Changes

- **Cadastro de lead** via `/admin/api` (exige sessão): `POST /admin/api/leads` com
  telefone E.164 + campos opcionais de contexto (nome, origem, notas). Persistido em
  `operational-data-store` (`leads`), com deduplicação por telefone.
- **Disparo de prospecção**: `POST /admin/api/leads/:leadPhone/prospect` — envia um
  **template aprovado** (nome + parâmetros do template no corpo ou em config), delegando ao
  `SendOutboundMessageUseCase`, e **semeia a `Conversation`**: cria o agregado (se não
  existir) e registra o turno outbound inicial com `origin: "operator"` e marcação de
  "prospecção". Idempotente por lead (não redispara se já houve prospecção, salvo `force`).
- **Estado de prospecção do lead**: `pending | sent | replied | failed`, derivado do
  resultado do envio e do primeiro inbound subsequente (o webhook já cria/atualiza a
  conversa hoje; a projeção liga o inbound ao lead).
- **Lote opcional (MVP enxuto)**: `POST /admin/api/leads/:leadPhone/prospect` um a um é o
  núcleo; disparo em lote / importação CSV fica marcado como extensão no design, não
  obrigatório nesta change.
- **Registro de consumo**: o envio do template gera evento de status da Meta → já capturado
  por `add-whatsapp-messaging-cost-tracking` como conversa `marketing`/`utility`. Nada novo
  aqui além de garantir o `wamid` correlacionável ao lead.
- **Guardas**: template é obrigatório para primeiro contato (fora da janela de 24 h);
  telefone inválido → `422`; falha no gateway → estado `failed` + `502`, sem semear turno
  "enviado".

## Capabilities

### New Capabilities
- `outbound-prospecting`: o sistema permite iniciar ativamente a conversa com um lead —
  cadastrar o lead, disparar uma mensagem de template aprovada como primeiro contato e criar
  a conversa correspondente já com o turno inicial registrado, acompanhando o estado de
  prospecção de cada lead. O disparo é autenticado, idempotente por lead e serializado com o
  processamento de mensagens desse lead.

### Modified Capabilities
- `whatsapp-connectivity`: o requisito **"Envio de Mensagem de Template"** passa a ter um
  **gatilho HTTP autenticado** (antes só chamável em código); o envio de template para
  primeiro contato de prospecção é um caso de uso exposto pela API de gestão.
- `conversation-engine`: o **"Histórico Persistido da Conversa"** passa a admitir a
  **criação de uma conversa por iniciativa outbound** (turno inicial `origin: "operator"`,
  antes de qualquer inbound), além da criação disparada pelo primeiro inbound.

## Impact

- **Código**:
  - `src/management/**` — rotas `POST /admin/api/leads`, `.../prospect`;
  - novo use-case de aplicação: valida lead → envia template → cria/atualiza `Conversation`
    → persiste, sob a fila do lead;
  - `src/conversation-engine/domain/conversation.ts` — `createSeededByProspecting(...)` /
    `recordProspectingTurn(...)` (reusa o `origin` da change de ações);
  - adapter `leads` + migration; projeção liga inbound → lead;
  - `src/main.ts` — fiação do gateway/template na API de gestão; remover os exports de QA
    manual se substituídos.
- **Dependência de change**: `add-management-api` (plugin + sessão); reusa `origin` de
  `add-management-conversation-actions`; `add-whatsapp-messaging-cost-tracking` para o custo
  do template aparecer no painel.
- **Configuração**: nome(s) de template aprovado(s) e variáveis — em env ou tabela de
  config; idioma do template.
- **Fora de escopo**: editor/registro de templates na Meta; segmentação e agendamento de
  campanha; importação CSV em massa (extensão futura); a UI de prospecção
  (`add-management-web-ui`).
