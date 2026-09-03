## Context

Ver `proposal.md` — Why. Estado atual relevante (verificado no código):

- A capability `outbound-prospecting` já entrega o disparo **individual**:
  `ProspectLeadUseCase` (idempotente por lead, roda na `LeadSerialQueue`, envia template
  via `SendOutboundMessageUseCase`, semeia a `Conversation`, `markProspected`/`markFailed`),
  `RegisterLeadUseCase` (upsert), `SqliteLeadRepository` (`upsert` com `COALESCE`,
  `findByPhone`, `markProspected/Failed/Replied`), tabela `leads` (migration `0006`),
  rotas `POST /admin/api/leads` e `POST /admin/api/leads/:leadPhone/prospect`.
- `SqliteLeadRepository` **não tem** método de query/listagem.
- O template de primeiro contato vem de `env` (`PROSPECTING_TEMPLATE_*`) e já é injetado.
  `abertura_lead_obras` não tem variáveis por ora.
- A auditoria (`AdminActionAuditPort`) já é usada pelo disparo individual com
  `action: "prospect"` e é best-effort.
- O runner de migrations é forward-only, aplicado no boot, uma migration por transação.
- Panel: React + react-query + contratos zod em `wpp_prospector_bot_server/contracts`
  (import via `src/api/contracts.ts`), `src/api/endpoints.ts` para as chamadas,
  polling com suspensão quando a aba não está visível, shadcn/ui, `getCapabilities()`
  já existe no cliente e tolera a ausência do endpoint. Sem lib de planilha hoje.
- Fastify sem `@fastify/multipart`.

## Goals / Non-Goals

**Goals:**

- Reusar integralmente o `ProspectLeadUseCase` no disparo em lote — zero duplicação da
  lógica de envio/semeadura/idempotência.
- Manter o servidor enxuto: a leitura do `.xlsx` acontece no cliente; o servidor recebe
  JSON validado por zod.
- Uma única migration aditiva (`0007`), sem alterar dados existentes.
- Contratos tipados para tudo que o painel consome (listagem, import, disparo em lote,
  reset), validados em dev/teste como o restante da `management-api`.

**Non-Goals:**

- Disparo assíncrono / fila de background com `batchId` e polling de progresso. O volume
  atual (dezenas) é resolvido síncrono. Fica para uma change futura se o volume crescer.
- Histórico/auditoria de importações (tabela `lead_imports`). Não nesta change.
- Mapeamento de colunas assistido na UI (dropdowns). Nesta change o reconhecimento da
  planilha é por aba/cabeçalho conhecidos, com erro claro quando não bate.
- Parâmetros de template por lead (o template não tem variáveis).
- Suporte a leads fora do Brasil.
- Upload do arquivo binário para o servidor.

## Decisions

### D1. Leitura do `.xlsx` no cliente; servidor recebe JSON

O painel usa SheetJS (`xlsx`) no bundle para ler o arquivo, reconhecer a aba
`03_Leads_CRM`, extrair as 4 colunas (`C` empresa/nome, `F` telefone, `D` segmento,
`E` cidade), normalizar telefone e separar válidos × rejeitados. `POST
/admin/api/leads/import` recebe `{ leads: [{ phone, company?, segment?, city?,
displayName?, source?, notes? }] }` já limpo.

- **Por quê:** evita `@fastify/multipart` e o parsing de binário no servidor; o preview
  fica instantâneo e sem round-trip; o arquivo (que é o plano comercial inteiro) não sai
  da máquina do operador — só os 4 campos por lead.
- **Alternativa considerada:** upload multipart + parse no servidor. Rejeitada: superfície
  nova maior, sem ganho de preview, e move um documento sensível para o servidor.
- **Consequência:** a regra de mapeamento de colunas e a heurística de aba moram no
  front. A **normalização/validação de telefone é reaplicada no servidor** como fonte da
  verdade (o `import.use-case` revalida cada `phone` contra `E164_REGEX`), então o
  cliente não é confiável para a validação — só para o preview.

### D2. Normalização de telefone BR → E.164 num módulo compartilhável

Função pura `normalizeBrazilPhone(raw): { phone } | { rejected: reason }`:

```
strip não-dígitos
  → 10-11 díg sem DDI  ⇒ prefixa "55"
  → "+" + dígitos
  → E164_REGEX  &&  regra BR:
        13 díg (55 + DDD 2 + 9 + 8)  ⇒ celular  → aceito
        12 díg                       ⇒ provável fixo → rejeitado(reason: "fixo")
        else                         ⇒ rejeitado(reason: "curto" | "longo" | "vazio")
```

- Vive em `whatsapp-connectivity/domain` (junto de `E164_REGEX`) ou num
  `shared/phone/`; consumida pelo `import.use-case` no servidor. O cliente tem a sua
  própria cópia da heurística para o preview (TS puro, sem dependência de runtime Node).
- **Por quê BR fixo:** decisão do produto (todos os leads são Brasil). Sem env de país
  para não introduzir configuração que ninguém vai mexer.
- **Trade-off:** a distinção celular/fixo por contagem de dígitos é heurística; um fixo
  com 9º dígito digitado errado pode passar. Aceitável — a Meta rejeita no envio e o
  lead vai para `failed`, visível na tela.

### D3. `import.use-case` — upsert em lote com "planilha vence"

Novo `ImportLeadsUseCase`:

- Para cada item: revalida `phone`; inválido → acumula em `rejected[]` com a linha de
  origem; válido → `leads.upsertFromImport(item)`.
- **Dedup no lote:** colapsa telefones repetidos antes de gravar, última ocorrência vence.
- **Semântica de sobrescrita:** diferente do `upsert` atual (que faz `COALESCE`, só
  preenche vazio), o caminho de import **sobrescreve** `company`/`segment`/`city`/
  `displayName` com o que veio (inclusive para `null`? — não: só sobrescreve campos
  **presentes** no item; um campo ausente na planilha não apaga o que está no banco).
  `prospecting_state` e carimbos nunca são tocados.
- Implementação no repositório: um segundo SQL de upsert (`ON CONFLICT DO UPDATE SET
  company = excluded.company, ...` sem `COALESCE`) ou um parâmetro no método. Opto por
  **método separado** `upsertFromImport` para não arriscar o comportamento do cadastro
  individual.
- **Retorno:** `{ imported: n, updated: m, rejected: [{ row, phone, reason }] }`.
- **Limite:** `MAX_IMPORT_ROWS` (constante, ex. 1000). Acima → 422 antes de gravar.
- **Sem transação única obrigatória:** o lote pode ser gravado item a item; uma falha de
  escrita inesperada de um item não precisa reverter os demais (best-effort, igual ao
  espírito continue-on-error). Se for trivial envolver em uma transação, melhor; não é
  requisito.

### D4. `bulk-prospect.use-case` — itera o `ProspectLeadUseCase`, continue-on-error

Novo `BulkProspectLeadsUseCase`:

- Recebe `phones: string[]`, `force?: boolean`, `MAX_PROSPECT_BATCH` (ex. 100) → 422 acima.
- Colapsa duplicados. Para cada telefone, chama o `ProspectLeadUseCase.prospect(phone,
  { force })` já existente, capturando exceção por telefone:
  - sucesso com `wamid` → `{ phone, outcome: "sent", wamid, lead }`
  - `alreadyProspected` (retorno atual do use-case quando `sent`/`replied` sem `force`)
    → `{ phone, outcome: "skipped", lead }`
  - `LeadNotFoundError` / `InvalidLeadPhoneError` / `ProspectingGatewayError` /
    `FirstContactTemplateNotConfiguredError` → `{ phone, outcome: "failed", reason }`
- **Concorrência:** `p-limit`-like manual, `CONCURRENCY = 4`, entre telefones distintos.
  A `LeadSerialQueue` já garante serialização **por lead**; o cap só evita martelar a
  Cloud API. Sem `sleep` fixo — o cap de concorrência é suficiente para o volume atual.
- **Idempotência:** herdada do `ProspectLeadUseCase` (nada a fazer).
- **Auditoria:** herdada — cada disparo efetivo já grava `action: "prospect"`. O lote
  não gera uma entrada própria.
- Síncrono: a request HTTP segura até o lote terminar. Para 100 telefones × ~1 req à
  Meta cada, com concorrência 4, fica em segundos–baixas dezenas de segundos. Aceitável.
- **Resposta:** `{ results: [{ phone, outcome, wamid?, reason?, lead }] }`, sempre 200
  quando a request foi processada (os erros por lead vão no corpo, não no status).

### D5. `reset.use-case` — só o registro do lead, conversa intacta

Novo `ResetLeadProspectingUseCase` + `leads.resetProspecting(phone)`:

```sql
UPDATE leads
SET prospecting_state = 'pending',
    first_contact_wamid = NULL, first_contact_at = NULL, replied_at = NULL,
    updated_at = ?
WHERE phone = ?
```

- Lead inexistente → `LeadNotFoundError` → 404. Telefone inválido → 422. Idempotente
  (rodar sobre `pending` é no-op efetivo).
- **Não toca a `Conversation`** — o arquivo JSON do lead e os turnos ficam. Um disparo
  posterior cai no ramo "conversa já existe ⇒ só acrescenta turno" que o
  `ProspectLeadUseCase` já implementa.
- **Não precisa da fila serial:** é escrita só na tabela `leads`, que não colide com o
  processamento de conversa. Mantém-se simples (fora da `LeadSerialQueue`).
- **Auditoria best-effort:** nova ação `action: "reset_prospecting"` no
  `AdminActionAuditPort` (mesmo padrão do `prospect`). Falha ao auditar → log, não
  desfaz.

### D6. Propriedade dos endpoints entre capabilities

- `outbound-prospecting`: mutações de lead — `POST /admin/api/leads/import`,
  `POST /admin/api/leads/prospect`, `POST /admin/api/leads/:leadPhone/reset` — porque a
  capability já é dona do ciclo de vida do lead e de `POST /admin/api/leads`.
- `management-api`: leitura — `GET /admin/api/leads` (análogo a `GET
  /admin/api/conversations`) — e `GET /admin/api/capabilities` (concern de superfície da
  API), mais os contratos tipados dos recursos de leads.
- Todas as rotas montadas no mesmo escopo com guarda de sessão
  (`register-admin-routes.ts`).

### D7. Listagem: query no repositório + cursor keyset

- `LeadRepositoryPort.query({ state?, phoneContains?, segment?, limit, cursor })` →
  `{ items: LeadRecord[], nextCursor: string | null }`.
- Ordenação determinística: `ORDER BY imported_at DESC NULLS LAST, phone ASC` (ou
  `updated_at` — a definir na implementação; o requisito só exige estabilidade). Cursor
  keyset codificando o par `(ordercol, phone)` do último item, base64 — mesmo estilo do
  índice de conversas.
- Contrato `leadListItemSchema` / `leadListPageSchema` em `interface/dto/lead.dto.ts`,
  reusando `leadResourceSchema` estendido com `company`/`segment`/`city`.

### D8. `GET /admin/api/capabilities`

Handler trivial que devolve `{ conversationActions: true, prospecting: true }` refletindo
o que `register-admin-routes` montou (hoje ambos sempre montados quando `/admin` está
ligado). O cliente (`getCapabilities`) já consome esse shape; passa a receber 200 em vez
de cair no `catch → null`.

### D9. Migration `0007_leads_import_fields.sql`

```sql
ALTER TABLE leads ADD COLUMN company     TEXT;
ALTER TABLE leads ADD COLUMN segment     TEXT;
ALTER TABLE leads ADD COLUMN city        TEXT;
ALTER TABLE leads ADD COLUMN imported_at TEXT;   -- ISO-8601 UTC; NULL p/ cadastro manual
CREATE INDEX idx_leads_segment ON leads (segment);
```

Aditiva, colunas nullable — bancos existentes seguem válidos sem backfill.

### D10. Frontend — estrutura

- `src/features/leads/`: `LeadsRoute.tsx`, `useLeadList.ts` (query + polling),
  `useImportLeads.ts` / `useBulkProspect.ts` / `useResetLead.ts` (mutations),
  `parse-leads-sheet.ts` (SheetJS + normalização + heurística de aba/coluna),
  `ImportDialog.tsx`, `ProspectConfirmDialog.tsx`, `LeadsTable.tsx`.
- `src/routes/router.tsx`: rota `leads`. `src/components/AppShell.tsx`: item de nav "Leads".
- `src/api/contracts.ts` + `endpoints.ts`: `listLeads`, `importLeads`, `bulkProspect`,
  `resetLead`. Disparo/reset seguem o padrão `useActionAvailability`/`getCapabilities`
  para ocultar/desabilitar quando indisponível.
- Nova dependência: `xlsx` (SheetJS). Só no panel.

## Risks / Trade-offs

- **Disparo síncrono longo** → com concorrência 4 e ~100 telefones, a request pode levar
  dezenas de segundos; um timeout de proxy/browser pode cortar. Mitigação: `MAX_PROSPECT_BATCH`
  baixo (100) nesta change; se incomodar, a change futura de disparo assíncrono resolve.
- **Cliente fecha a aba no meio do lote** → o servidor continua processando (a request
  Fastify não é cancelada) e o estado converge; a tela reflete no próximo polling.
  Aceitável.
- **Heurística celular/fixo** → falso-negativo (fixo aceito). Mitigação: a Meta rejeita e
  o lead fica `failed`, visível e resetável.
- **Reconhecimento da planilha acoplado a `03_Leads_CRM`** → se o operador renomear a aba
  ou reordenar colunas, o import falha com mensagem de formato. Mitigação: heurística de
  cabeçalho como fallback (procura coluna cujo header case/acento-insensível bata
  `contato|telefone|whatsapp|fone` e `empresa|lead|nome|razão`); erro claro se nada bate.
- **`xlsx` (SheetJS) no bundle** → acrescenta peso à SPA e histórico de CVEs de parsing.
  Mitigação: pinar versão, parsing roda no browser do operador (single-user, superfície
  de ataque baixa), considerar `sheetjs` community build atual. Alternativa mais leve
  (só `.csv`) foi descartada porque o operador quer selecionar o `.xlsx` direto.
- **Sobrescrita na re-importação** → um erro de digitação na planilha sobrescreve um
  campo bom no banco. Mitigação: só sobrescreve campos presentes no item; o preview
  mostra o que será enviado antes de confirmar.

## Migration Plan

1. Deploy do servidor: o boot aplica `0007` (forward-only, transação única). Bancos
   existentes ganham as colunas nullable; nenhum backfill.
2. Configurar `PROSPECTING_TEMPLATE_NAME=abertura_lead_obras` e
   `PROSPECTING_TEMPLATE_LANG=pt_BR` no ambiente (sem `PARAM_KEYS`).
3. Build do painel com a rota nova; servido como estático sob `/admin` como hoje.
4. **Rollback:** as colunas de `0007` são inertes para o código anterior (SELECTs
   antigos não as referenciam); reverter o deploy do código é suficiente. A migration
   não é revertida (forward-only) e não precisa ser — não quebra a versão anterior.
   Os endpoints novos simplesmente deixam de existir; o painel antigo não os chama.

## Open Questions

- Ordenação da listagem por `imported_at` vs `updated_at` — escolha de implementação que
  não muda o contrato (o requisito só pede ordem determinística e estável). Decidir ao
  implementar D7.
- Valor exato de `MAX_IMPORT_ROWS` e `MAX_PROSPECT_BATCH` e `CONCURRENCY` — ajustáveis
  sem mexer em spec; começar com 1000 / 100 / 4.
- `source` do lead importado: gravar `"planilha"` automaticamente ou deixar `null`.
  Sugerido `"planilha"`; não afeta contrato nem tasks.
