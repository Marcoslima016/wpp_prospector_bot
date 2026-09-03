# Explore — Importação de leads via Excel + disparo em massa da mensagem de abertura

> Sessão de exploração (não é implementação). Data: 2026-09-03.
> Objetivo: refinar as abordagens para a tela de configuração da lista de leads
> (importação por planilha) e o disparo da mensagem de abertura por seleção.

---

## 1. O que já existe (e é bastante)

A capability `outbound-prospecting` já está implementada e arquivada. O "disparo individual" já funciona ponta a ponta:

```
┌─ JÁ PRONTO ────────────────────────────────────────────────────────────┐
│                                                                        │
│  Tabela SQL `leads`  (migration 0006)                                   │
│    phone(PK E.164) · display_name · source · notes                      │
│    prospecting_state: pending → sent → replied / failed                 │
│    first_contact_wamid · first_contact_at · replied_at                  │
│                                                                        │
│  POST /admin/api/leads                 → RegisterLeadUseCase (upsert)   │
│  POST /admin/api/leads/:phone/prospect → ProspectLeadUseCase           │
│      · valida E.164 (422)                                               │
│      · idempotente por lead (sent/replied ⇒ no-op, salvo `force`)       │
│      · roda na LeadSerialQueue (não colide com inbound do mesmo lead)   │
│      · envia template aprovado (SendOutboundMessageUseCase)             │
│      · semeia a Conversation com turno outbound "primeiro contato"      │
│      · markProspected(wamid) / markFailed                              │
│                                                                        │
│  Template vem de env:  PROSPECTING_TEMPLATE_NAME / _LANG / _PARAM_KEYS  │
│                                                                        │
│  Panel: react-query + contratos zod tipados + endpoints.ts +           │
│         shadcn/ui + polling; já existe `getCapabilities()` e a flag     │
│         `prospecting` no cliente (mas nenhum endpoint /capabilities     │
│         no servidor ainda, e nenhuma tela de leads)                     │
└────────────────────────────────────────────────────────────────────────┘
```

O `ProspectLeadUseCase` inclusive já tem `markReplied` ligado ao primeiro inbound (via `prospecting-reply-tracker`).

---

## 2. O que falta para a tela

```
┌─ A CONSTRUIR ──────────────────────────────────────────────────────────┐
│  IMPORTAÇÃO                                                             │
│   1. Ler .xlsx  → não há nenhuma lib de Excel nas deps (nem no server  │
│      nem no panel). Decisão de onde parsear.                            │
│   2. Upload de arquivo → Fastify não tem @fastify/multipart hoje.      │
│   3. Normalizar telefone BR → E.164 e reportar linhas inválidas.       │
│   4. Persistir em lote (bulk upsert) SEM disparar nada.                │
│                                                                        │
│  LISTAGEM                                                               │
│   5. GET /admin/api/leads → NÃO existe. O SqliteLeadRepository só tem  │
│      upsert / findByPhone / mark*. Falta um método de query + read     │
│      model + contrato tipado + paginação/filtro.                       │
│                                                                        │
│  DISPARO EM MASSA                                                       │
│   6. Só existe o disparo unitário. Seleção por checkbox ⇒ ou N chamadas│
│      do cliente, ou um endpoint bulk novo.                             │
│                                                                        │
│  UI                                                                     │
│   7. Rota /leads no panel + item de nav + tela (import + tabela +      │
│      seleção + confirmação + status por lead + polling).               │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. A planilha real ≠ template de importação

O `Plano_ate_primeiro_cliente_v4.xlsx` não é um template limpo — é o plano comercial inteiro, com 7 abas:

| Aba | Conteúdo |
|---|---|
| `00_Dashboard` | KPIs |
| `01_Portfolio` | produtos |
| `02_Roadmap_1o_Cliente` | tarefas |
| **`03_Leads_CRM`** | **os leads, 35 preenchidos + 65 linhas vazias** |
| `04_Playbook` | scripts de abordagem |
| `05_Metricas` | métricas |
| `06_Proxima_Onda` | 15 leads priorizados (só nome, **sem telefone**) |

A aba `03_Leads_CRM` tem estas colunas:

```
A:ID  B:Produto  C:Empresa/Lead  D:Segmento  E:Cidade  F:Contato  G:Canal
H:Site/Instagram  I:Score  J:Classe  K:Status  L:Último contato
M:Próxima ação  N:Data próxima ação  O:Dor observada  P:Objeção
Q:Valor proposta  R:Resultado
```

Problemas concretos nos dados reais:

- **`F:Contato` está em formato BR local**: `(16) 99117-8924`, não `+5516991178924`.
- **Várias linhas sem telefone** (EDGE, Empática, Mollero, Barros, Bauen, D&A...).
- **Números malformados**: `G3 Construções` → `(16) 99740-10035` (dígitos a mais).
- **Fixos vs. móveis** misturados: `(16) 3913-4635` é fixo — não recebe WhatsApp.
- Nome do lead é **razão social** (`Strappa - Administração de Obras`), não pessoa.

Isso força uma decisão de fundo (ponto **B** abaixo).

---

## 4. Fluxo-alvo

```
 OPERADOR                       PANEL /admin/leads                 SERVER /admin/api
 ───────                        ─────────────────                  ────────────────
   │  seleciona .xlsx ──────────▶ [parse]
   │                              │  detecta aba/colunas
   │                              │  normaliza telefone
   │                              │  separa: válidos / rejeitados
   │  ◀── preview: "42 válidos, 7 rejeitados (motivo)" ─────────
   │  confirma importação ───────▶ POST /leads/import ────────────────▶ bulk upsert
   │                                                                    (state=pending)
   │  ◀───────────────── tabela de leads (GET /leads) ◀──────────────── read model
   │
   │  marca checkboxes  ┌──────────────────────────────┐
   │  [✓] Strappa        │  seleção N leads             │
   │  [✓] RV Eng.        │                              │
   │  [ ] ...            └──────────────────────────────┘
   │  "Disparar abertura (2)" ───▶ POST /leads/prospect ─────────────▶ p/ cada phone:
   │                                { phones:[...] }                     ProspectLeadUseCase
   │                                                                    (fila serial, idempotente)
   │  ◀── resultado por lead: sent / skipped / failed ◀────────────────
   │  tabela faz polling do prospecting_state ◀────────────────────────
```

---

## 5. Pontos de decisão

### A. Onde o `.xlsx` é lido — cliente ou servidor?

| | Parse no **panel** (browser) | Parse no **server** |
|---|---|---|
| Lib | `xlsx` (SheetJS) no bundle da SPA | `xlsx`/`exceljs` no server + `@fastify/multipart` |
| Payload | POST de **JSON já limpo** (`{leads:[...]}`) | upload binário multipart |
| Preview | trivial e instantâneo, sem round-trip | precisa endpoint de "dry-run" |
| Regras de negócio | ficam no cliente (ruim p/ reuso/teste) | ficam no server (bom) |
| Superfície nova no server | só `POST /leads/import` recebendo JSON | multipart + parsing + limites de tamanho |
| Arquivo sensível sai da máquina? | não (só os dados extraídos) | sim (o arquivo inteiro) |

**Recomendação:** parse no **panel**, servidor recebe **JSON validado por zod**. Mantém o server enxuto (hoje só tem fastify+zod+anthropic), evita multipart, dá preview grátis. A normalização de telefone canônica pode viver num módulo compartilhado (`E164_REGEX` já está em `whatsapp-connectivity/domain`) e ser aplicada **dos dois lados** — cliente para preview, servidor como fonte de verdade na hora de gravar.

Ponto em aberto: te incomoda a regra de mapeamento de colunas morar no front?

---

### B. Formato de importação — template rígido nosso, ou adaptador para a planilha real?

**Opção B1 — Template canônico.** Publicamos um `.xlsx`/`.csv` modelo com colunas fixas (`telefone`, `nome`, `segmento`, `cidade`, `origem`, `notas`). O operador cola os dados nesse modelo. Import falha cedo se as colunas não baterem.

- ✅ simples, previsível, testável
- ❌ o operador tem que retrabalhar a planilha que já mantém

**Opção B2 — Adaptador para a planilha existente.** Reconhece a aba `03_Leads_CRM` por nome, mapeia `C→nome`, `F→telefone`, `D→segmento`, `E→cidade`, `K→origem/status`. Ignora as outras abas.

- ✅ o operador importa o arquivo que já tem
- ❌ acoplado a um layout específico; muda a planilha, quebra o import
- ❌ `06_Proxima_Onda` (a lista priorizada) não tem telefone — inútil para disparo

**Opção B3 — Mapeamento assistido na UI.** Import lê **todas as abas/colunas**, mostra um passo "qual coluna é o telefone? qual é o nome?" com dropdowns, e lembra o mapeamento.

- ✅ funciona com qualquer planilha, agora e depois
- ✅ resolve abas múltiplas (operador escolhe a aba)
- ❌ mais UI para construir

**Recomendação:** **B3 enxuto** — detecção automática com _fallback_ manual. Tenta achar colunas por heurística de cabeçalho (`/contato|telefone|whatsapp|fone/i`, `/empresa|lead|nome|razão/i`); se achar, mostra preview direto; se não, cai no seletor de colunas. É pouco mais de UI que B1 e não prende à v4 da planilha. Para MVP mais rápido, **B1** e evoluímos.

Decisão relacionada: **quais campos** além de telefone+nome persistimos? A tabela `leads` hoje só tem `display_name`, `source`, `notes`. Segmento/cidade/score/empresa caberiam em `notes` (concatenado) ou pediriam colunas novas (ponto D).

---

### C. Normalização de telefone e linhas inválidas

Pipeline proposto (roda no preview e de novo no server):

```
"(16) 99117-8924"
   │  strip não-dígitos                → "16991178924"
   │  sem DDI e 10-11 díg. ⇒ prefixa 55 → "5516991178924"
   │  + "+"                             → "+5516991178924"
   │  valida E164_REGEX + regras BR:
   │     móvel = 13 díg (55 + DDD 2 + 9 + 8)
   │     fixo  = 12 díg  ⇒ marcar "provável fixo, não recebe WhatsApp"
   ▼
 aceito  |  rejeitado{motivo: vazio | curto | longo | fixo | DDI estrangeiro}
```

- Linhas rejeitadas **não** bloqueiam a importação — vão para um painel "7 linhas ignoradas" com o motivo, exportável. Operador corrige na planilha e re-importa (o upsert é idempotente por telefone).
- **DDI configurável?** Hoje é tudo BR. Um env `DEFAULT_COUNTRY_CODE=55` evita hard-code.
- **Dedup dentro do próprio arquivo** (mesmo telefone em 2 linhas) — resolver no cliente antes de enviar; última linha vence, ou avisa conflito.

Pergunta: os leads são sempre BR, ou pode vir de fora?

---

### D. Modelo de dados — estende `leads` ou tabela nova?

- **D1.** Reusar `leads` como está. Segmento+cidade+empresa viram texto em `notes`, `source` recebe algo como `"planilha:03_Leads_CRM"`. Zero migration.
- **D2.** Migration `0007` adiciona colunas nullable (`company`, `segment`, `city`, `score`, `imported_at`, `import_batch_id`). Mais fiel, permite filtrar/ordenar por segmento na tabela, e rastreia "de qual importação veio este lead".
- **D3.** Tabela separada `lead_imports` (lote) + `lead_import_rows` (auditoria do que entrou/foi rejeitado), `leads` continua igual.

**Recomendação:** **D2 mínimo** — `company`, `segment`, `city`, `imported_at` nullable + índice em `segment`. Sem lote/batch por ora (YAGNI). `score`/`classe` do CRM são do processo comercial manual, não do bot — deixaria de fora. Se quiser histórico de importações, aí sim D3 entra numa change futura.

---

### E. Endpoint de listagem `GET /admin/api/leads`

Não existe nada. Precisa:

- método `query()` no `LeadRepositoryPort` + `SqliteLeadRepository`
- read model / contrato `leadListPageSchema` no módulo de contratos (`interface/dto/`)
- paginação por cursor (mesmo padrão de `GET /conversations`)
- filtros: por `prospectingState`, por trecho de telefone, por segmento, por origem
- ordenação: `imported_at desc` ou `updated_at desc`

Isso é um **delta na spec `management-api`** (hoje ela diz "somente leitura nesta capability" para stats/conversas — leads de leitura encaixam bem) **e** na `outbound-prospecting`.

Decisão: a listagem mostra **todos os leads** ou dá para filtrar "só os `pending`" com destaque? Para o fluxo de disparo, provavelmente quer ver `pending` por padrão e ter uma aba/filtro para os já contatados.

---

### F. Disparo em massa — N chamadas do cliente, ou endpoint bulk?

| | **N × POST /leads/:phone/prospect** (cliente orquestra) | **POST /leads/prospect { phones:[] }** (bulk no server) |
|---|---|---|
| Código novo no server | zero | use-case + rota + contrato de resultado por lead |
| Resultado parcial | cliente agrega (alguns 200, alguns 502) | server devolve `[{phone, outcome: sent\|skipped\|failed, reason}]` |
| Rate limit da Meta | cliente tem que espaçar (a Cloud API tem limites de throughput e de "messaging limit" por número) | server controla ritmo/concorrência num lugar só |
| Fila serial | já é por lead; disparos de leads distintos já podem ir em paralelo | idem, server itera e enfileira |
| Reload/fecha aba no meio | interrompe o lote | server termina o lote |
| Auditoria | 1 entrada por lead (já existe) | idem |
| Observabilidade | difícil ver "lote de 40" como unidade | dá para logar o lote |

**Recomendação:** **endpoint bulk** `POST /admin/api/leads/prospect` recebendo `{ phones: string[], force?: boolean }`, que internamente faz um `for` chamando o `ProspectLeadUseCase` já existente (com um limite de concorrência tipo 3–5 e um pequeno _delay_), e responde com **status por lead**. Reaproveita 100% da lógica unitária (idempotência, fila, semeadura, markFailed) e blinda contra o operador fechar a aba. O cap de itens por lote (ex. 100) e o comportamento em erro parcial (continua o resto — sim) entram na spec.

Sub-decisão: disparo **síncrono** (request segura até o lote acabar — ok para dezenas, ruim para centenas) vs **assíncrono** (retorna um `batchId`, cliente faz polling). Para o volume atual (35 leads, "primeira onda de 15") o síncrono resolve. Async é uma change futura se o volume crescer.

---

### G. O template `abertura_lead_obras`

- A infra já lê `PROSPECTING_TEMPLATE_NAME` / `_LANG` / `_PARAM_KEYS` do env e o `ProspectLeadUseCase` já envia via `SendOutboundMessageUseCase`. **Provavelmente não precisa de código novo aqui** — só configurar `PROSPECTING_TEMPLATE_NAME=abertura_lead_obras`, `PROSPECTING_TEMPLATE_LANG=pt_BR`.
- Confirmar: **o template tem parâmetros?** O texto de "Abertura" no `04_Playbook` da planilha é uma mensagem fixa e longa (~590 chars), sem placeholders visíveis. Se o template aprovado na Meta também for sem variáveis, `_PARAM_KEYS` fica vazio e a UI de disparo não pede nada. Se tiver `{{1}}` (ex. nome da empresa), a UI precisa de um passo de mapeamento de parâmetro por lead.
- O **ID** `1403941885005931` foi informado. A Cloud API envia template **por nome + idioma**, não por ID — o ID serve para consultas de gestão de template. O que importa no env é o nome. Confirmar que o nome exato é `abertura_lead_obras`.
- Verificar o **idioma** cadastrado (às vezes é `pt_BR`, às vezes `pt_BR` + `pt`); tem que bater exatamente ou a Meta rejeita.

---

### H. A tela `/admin/leads`

Esboço:

```
┌ Leads ─────────────────────────────────────────────── [ Importar planilha ]┐
│ Filtros: [estado ▾ pending] [segmento ▾] [busca telefone____]              │
├───┬─────────────────────────┬───────────────┬──────────┬─────────┬─────────┤
│[✓]│ Empresa / Nome          │ Telefone      │ Segmento │ Estado  │ Contato │
├───┼─────────────────────────┼───────────────┼──────────┼─────────┼─────────┤
│[✓]│ Strappa Adm. de Obras   │ +5516999...   │ Gestão   │ pending │   —     │
│[✓]│ RV Engenharia           │ +5516997...   │ Constr.  │ pending │   —     │
│[ ]│ Eduardo Berres          │ +5516997...   │ Gestão   │  sent   │ 3h atrás│
│[ ]│ Construtora Zion        │ +5516997...   │ Constr.  │ replied │ ✔       │
├───┴─────────────────────────┴───────────────┴──────────┴─────────┴─────────┤
│ 2 selecionados          [ Disparar mensagem de abertura (2) ]              │
└───────────────────────────────────────────────────────────────────────────┘

Modal de importação:
  [1] escolher arquivo  →  [2] confirmar aba + colunas (auto-detectado ✓)
  →  [3] preview: "42 leads válidos · 7 ignorados ⓘ"  →  [Importar]

Modal de confirmação de disparo:
  "Enviar 'abertura_lead_obras' para 2 leads. Isso inicia conversa real. Confirmar?"
  → progresso → "2 enviados · 0 falharam"
```

Detalhes de UX a alinhar:

- Só deixar marcar checkbox de quem está `pending`/`failed`? Ou permitir re-disparo com `force` explícito para `sent`/`replied` (com aviso forte)?
- "Selecionar todos os `pending` visíveis" / "todos os `pending` do filtro".
- Feedback pós-disparo por linha (badge que muda de `pending`→`sent` via polling, igual ao resto do painel).
- Estado vazio: "Nenhum lead ainda — importe uma planilha."
- A superfície de ação deve seguir o padrão já existente (`useActionAvailability` / `getCapabilities`) — botão some/desabilita se o deploy não tem os endpoints.

---

### I. Recorte OpenSpec

Isto toca três capabilities. Sugestão de uma **única change** `add-lead-import-and-bulk-prospecting` com deltas:

```
outbound-prospecting   ← importação em lote (novos requisitos)
                         + disparo em massa (novo requisito)
                         + campos de contexto do lead (company/segment/city)
management-api          ← GET /admin/api/leads (listagem paginada/filtrável)
                         + POST /admin/api/leads/import
                         + POST /admin/api/leads/prospect (bulk)
                         + contratos tipados de lead
management-web-ui       ← tela de leads: importação + seleção + disparo
operational-data-store  ← migration 0007 (colunas novas em `leads`)  [se D2]
```

Alternativa: duas changes sequenciais — (1) "listagem + importação de leads", (2) "disparo em massa" — se quiser entregar e validar a importação antes de mexer no disparo. Dado que o disparo unitário já existe, o incremento do bulk é pequeno; a recomendação é **uma change só**.

---

## 6. Perguntas que mais destravam o refinamento

1. **Planilha:** aceitamos a `03_Leads_CRM` como está (adaptador/mapeamento) ou topa preencher um template canônico nosso? _(ponto B)_
2. **Template `abertura_lead_obras`:** tem variáveis (`{{1}}`, `{{2}}`…) ou é mensagem fixa? Idioma cadastrado?
3. **Telefones:** sempre Brasil? Como tratar as linhas sem telefone / fixos — ignora e reporta, ou importa mesmo assim?
4. **Campos extras** (segmento, cidade, empresa): guardar em colunas próprias (migration nova) ou jogar tudo em `notes`? _(ponto D)_
5. **Disparo em massa:** ok com endpoint bulk **síncrono** (aguenta dezenas)? E o comportamento em erro parcial — continua disparando o resto? _(ponto F)_
6. **Re-disparo:** a tela deixa selecionar quem já está `sent`/`replied` (com `force` e aviso), ou só `pending`/`failed`?

---

## 7. Decisões tomadas (2026-09-03)

| # | Decisão |
|---|---|
| **1. Planilha** | **Adaptador para `03_Leads_CRM`**, sem template canônico. Ler só as colunas usadas — `C:Empresa/Lead` → nome/empresa, `F:Contato` → telefone, `D:Segmento`, `E:Cidade`. Todas as outras colunas e todas as outras abas são ignoradas. |
| **2. Template** | `abertura_lead_obras`, **sem variáveis** por ora (pode ganhar no futuro). `PROSPECTING_TEMPLATE_PARAM_KEYS` vazio; a UI de disparo não pede nenhum parâmetro. Envio por **nome + idioma** (`pt_BR`), não por ID. |
| **3. Telefones** | **Sempre Brasil** (DDI 55 fixo, sem env de país). Linha sem telefone, telefone malformado ou fixo → **ignorada e reportada** no preview; não entra no banco. |
| **4. Campos extras** | **Migration nova** (`0007`) adiciona colunas próprias em `leads`: `company`, `segment`, `city` (+ `imported_at`). Nada de concatenar em `notes`. |
| **5. Disparo em massa** | Endpoint **bulk síncrono**. Em erro de um lead, **segue disparando os demais** (nunca aborta o lote). Resposta traz o resultado por lead (`sent` / `skipped` / `failed` + motivo). |
| **6. Re-disparo** | A tabela só deixa **selecionar `pending` / `failed`**. Leads `sent` / `replied` aparecem com checkbox **desabilitado**. Cada linha ganha um **botão "Resetar prospecção"** individual (com confirmação) para o caso esporádico de precisar reabrir — devolve o lead a `pending` e o re-habilita para disparo. |

### Forma resultante (para a proposta)

```
BACKEND
  migration 0007_leads_import_fields.sql
     ALTER TABLE leads ADD company TEXT, ADD segment TEXT, ADD city TEXT, ADD imported_at TEXT
     (índice em segment)

  LeadRepositoryPort
     + upsert(...)      passa a aceitar company / segment / city
     + query(filtro, paginação)            → listagem
     + resetProspecting(phone)             → state volta a 'pending',
                                             limpa first_contact_wamid/at, replied_at

  Contratos tipados (interface/dto/lead.dto.ts)
     + leadListItemSchema / leadListPageSchema
     + importLeadsResultSchema  { imported, updated, rejected:[{row, phone, reason}] }
     + bulkProspectResultSchema { results:[{phone, outcome, reason?}] }

  Rotas /admin/api
     + GET  /leads                  listagem paginada/filtrável (state, phone, segment)
     + POST /leads/import           { leads:[{phone, company?, segment?, city?}] } → bulk upsert, state=pending, nunca dispara
     + POST /leads/prospect         { phones:[...] } → itera ProspectLeadUseCase (conc. 3–5), continue-on-error, síncrono
     + POST /leads/:leadPhone/reset → resetProspecting + auditoria best-effort
     (+ GET /capabilities passa a existir, marcando prospecting=true)

FRONTEND (panel)
  rota /leads + item de nav "Leads"
  parser .xlsx client-side (SheetJS) — reconhece a aba 03_Leads_CRM,
     heurística de cabeçalho p/ achar as 4 colunas, normaliza telefone,
     separa válidos × rejeitados, mostra preview antes de POST /leads/import
  tabela: checkbox (só pending/failed), filtros, badge de estado, polling do state,
     botão "Disparar mensagem de abertura (N)" + modal de confirmação,
     botão "Resetar" por linha (confirmação)

SEM MUDANÇA
  ProspectLeadUseCase, envio de template, semeadura de conversa, fila serial,
  markProspected/markFailed, prospecting-reply-tracker
```

### Micro-pontos ainda em aberto (detalhe de `design.md`, não bloqueiam o scaffold)

- **Reset** mexe só no registro do lead (`leads`) — **não** apaga a `Conversation` nem os turnos já gravados. Um re-disparo depois só acrescenta um novo turno "primeiro contato" à conversa existente. _(assumido; confirmar)_
- **Re-importar** um telefone que já existe: os valores da planilha (`company`, `segment`, `city`) **sobrescrevem** o que está no banco (planilha vence), em vez do `COALESCE` atual que só preenche vazio. _(assumido; confirmar)_
- **Detecção da aba**: por nome exato `03_Leads_CRM` com _fallback_ para "primeira aba cujo cabeçalho tenha uma coluna de telefone reconhecível"; se não achar, erro claro no modal. _(assumido)_
- **`source`** do lead importado: preencher automaticamente com algo como `"planilha"` para distinguir de cadastro manual, ou deixar nulo. _(indiferente; sugiro `"planilha"`）_
- **Cap do lote** de disparo (ex.: 100 telefones por request) e do import (ex.: 1000 linhas). _(número a definir)_

---

## 8. Próximo passo

Decisões 1–6 fechadas. Pronto para **scaffold da change** (`openspec new change`) e geração de `proposal.md` / `design.md` / delta specs (`outbound-prospecting`, `management-api`, `management-web-ui`, `operational-data-store`) / `tasks.md` — como **uma única change**.
