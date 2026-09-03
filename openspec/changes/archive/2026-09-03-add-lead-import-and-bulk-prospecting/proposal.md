## Why

Hoje o operador só consegue cadastrar e prospectar leads **um a um**, via chamadas
avulsas à API — não há tela, não há como carregar uma lista pronta, e não há disparo
em lote. A operação real começa de uma planilha com dezenas de leads e precisa
selecionar um subconjunto e enviar a mensagem de abertura de uma vez. Esta change
entrega a tela de leads no painel e as capacidades de importação e disparo em massa
que faltam para essa operação.

## What Changes

- **Importação de leads por planilha**: o painel lê um arquivo `.xlsx` da máquina do
  operador (aba `03_Leads_CRM` do plano comercial), extrai as colunas úteis
  (empresa/nome, telefone, segmento, cidade), normaliza o telefone para E.164
  brasileiro, separa linhas válidas de rejeitadas (sem telefone, malformado, fixo) e
  mostra um preview. Ao confirmar, os leads válidos são persistidos em lote com
  estado `pending`. **A importação nunca dispara mensagem.**
- **Campos de contexto do lead ampliados**: `company`, `segment`, `city` (além dos já
  existentes `displayName`, `source`, `notes`), com uma migration nova. Numa
  re-importação do mesmo telefone, os valores da planilha sobrescrevem os do banco.
- **Listagem de leads**: novo `GET /admin/api/leads` — página filtrável (por estado de
  prospecção, trecho de telefone, segmento) e paginada por cursor, no mesmo padrão da
  listagem de conversas.
- **Disparo em massa**: novo `POST /admin/api/leads/prospect` que recebe uma lista de
  telefones e dispara o primeiro contato para cada um reusando o
  `ProspectLeadUseCase` já existente. Síncrono, com limite de concorrência; **um lead
  que falha não aborta o lote** — a resposta traz o resultado por lead
  (`sent` / `skipped` / `failed` + motivo).
- **Reset de prospecção por lead**: novo `POST /admin/api/leads/:leadPhone/reset` que
  devolve um lead já contatado ao estado `pending`, limpando os carimbos de primeiro
  contato, para reabrir a prospecção em casos esporádicos. Não apaga a conversa.
- **Tela `/admin/leads` no painel**: item de navegação novo, ação de importar planilha,
  tabela de leads com checkbox (habilitado só para `pending` / `failed`), botão de
  disparar a abertura para a seleção com confirmação, botão de resetar por linha, e
  atualização do estado por polling.
- **`GET /admin/api/capabilities`** passa a existir e a marcar `prospecting: true`, para
  o painel condicionar a superfície de ação (o cliente já tolera sua ausência).

Sem mudança de comportamento: `ProspectLeadUseCase`, envio de template, semeadura da
conversa, fila serial por lead, `markProspected` / `markFailed` e o rastreio do
primeiro inbound (`prospecting-reply-tracker`).

## Capabilities

### New Capabilities

_Nenhuma._

### Modified Capabilities

- `outbound-prospecting`: **campos de contexto do lead ampliados** (`company` /
  `segment` / `city`) no cadastro e no contrato tipado; novos endpoints de
  **importação de leads em lote** (`POST /admin/api/leads/import`, sem disparo, planilha
  vence na re-importação), **disparo de prospecção em lote** (`POST
  /admin/api/leads/prospect`, idempotente por lead, continue-on-error) e **reset de
  prospecção por lead** (`POST /admin/api/leads/:leadPhone/reset`).
- `management-api`: novo endpoint de **listagem paginada e filtrável de leads** (`GET
  /admin/api/leads`, análogo à listagem de conversas), **descoberta de capacidades da
  API** (`GET /admin/api/capabilities`), e os **contratos tipados** dos recursos de
  leads (listagem, importação, disparo em lote, reset) validados em dev/teste.
- `management-web-ui`: novo requisito de **tela de leads** — importar planilha,
  listar/filtrar leads, selecionar e disparar a mensagem de abertura em lote, resetar
  a prospecção de um lead.

## Impact

- **Banco**: nova migration `0007` (colunas em `leads` + índice em `segment`). Aplicada
  no boot pelo runner forward-only já existente.
- **Backend** (`src/management/`):
  - `application/ports/lead-repository.port.ts` — `upsert` aceita os campos novos;
    novos métodos `query(...)` e `resetProspecting(phone)`.
  - `infrastructure/persistence/sqlite-lead-repository.ts` — implementação.
  - `application/` — novos casos de uso `import-leads.use-case.ts`,
    `bulk-prospect-leads.use-case.ts`, `reset-lead-prospecting.use-case.ts`.
  - `infrastructure/http/admin-leads.routes.ts` — 3 rotas novas; nova rota
    `admin-capabilities.routes.ts`.
  - `interface/dto/lead.dto.ts` — contratos de listagem, importação e disparo em lote.
  - `interface/lead.mapper.ts` — mapear os campos novos.
  - `infrastructure/http/register-admin-routes.ts` — montar as rotas novas.
- **Frontend** (`wpp_prospector_bot_panel`):
  - Nova dependência: parser de `.xlsx` (SheetJS `xlsx`) no bundle da SPA.
  - `src/features/leads/` — rota, hooks de query/mutation, parser de planilha,
    componentes de tabela/import/confirmação.
  - `src/routes/router.tsx` e `src/components/AppShell.tsx` — rota e item de nav.
  - `src/api/endpoints.ts` e `src/api/contracts.ts` — funções e contratos novos.
- **Config**: `PROSPECTING_TEMPLATE_NAME=abertura_lead_obras`,
  `PROSPECTING_TEMPLATE_LANG=pt_BR` (sem `PARAM_KEYS`). DDI Brasil (55) fixo, sem env
  novo.
- **Sem breaking changes.** Endpoints e colunas são aditivos; a tela nova não altera as
  existentes.
