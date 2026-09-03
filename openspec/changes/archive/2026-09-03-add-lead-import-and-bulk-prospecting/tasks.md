## 1. Banco — migration dos campos de importação

- [x] 1.1 Criar `src/shared/persistence/sqlite/migrations/0007_leads_import_fields.sql` adicionando as colunas `company`, `segment`, `city`, `imported_at` (todas `TEXT` nullable) em `leads` e o índice `idx_leads_segment` (ver design D9).
- [x] 1.2 Estender `src/shared/persistence/sqlite/leads-schema.test.ts` para cobrir as colunas e o índice novos, e confirmar que um banco só com `0001..0006` migra para `0007` sem erro.

## 2. Domínio — normalização de telefone BR → E.164

- [x] 2.1 Criar uma função pura `normalizeBrazilPhone(raw): { phone: string } | { rejected: "vazio" | "curto" | "longo" | "fixo" | "invalido" }` (ver design D2), colocada junto de `E164_REGEX` em `whatsapp-connectivity/domain` ou em `src/shared/phone/`.
- [x] 2.2 Testes unitários: `(16) 99117-8924` → `+5516991178924`; `16997379471` → `+5516997379471`; fixo `(16) 3913-4635` → `rejected: "fixo"`; vazio → `rejected: "vazio"`; `169974010035` (dígitos a mais) → `rejected: "longo"`; já em `+55...` válido passa inalterado.

## 3. Persistência — porta e adapter de leads

- [x] 3.1 Em `src/management/application/ports/lead-repository.port.ts`: adicionar `company`, `segment`, `city`, `importedAt` a `LeadRecord`; adicionar `company?/segment?/city?` a `LeadContextInput`; declarar `upsertFromImport(input)` (sobrescreve campos presentes, nunca toca estado/carimbos), `query(params)` e `resetProspecting(phone)`.
- [x] 3.2 Em `src/management/infrastructure/persistence/sqlite-lead-repository.ts`: novo SELECT com as colunas novas em `toRecord`; `upsertFromImport` com `ON CONFLICT DO UPDATE SET company = excluded.company, ...` (sem `COALESCE`) só para campos presentes; `resetProspecting` com o UPDATE do design D5; `query` com filtros `state`/`phoneContains`/`segment`, `ORDER BY` determinístico e cursor keyset base64 (design D7).
- [x] 3.3 Estender `src/management/infrastructure/persistence/sqlite-lead-repository.test.ts`: `upsertFromImport` cria e sobrescreve preservando `prospecting_state`; `resetProspecting` volta a `pending` e zera `first_contact_wamid/at`, `replied_at`; `resetProspecting` de telefone inexistente é no-op reportável; `query` filtra por estado/segmento/trecho, ordena de forma estável e pagina pelo cursor.

## 4. Contratos tipados (DTOs)

- [x] 4.1 Em `src/management/interface/dto/lead.dto.ts`: estender `leadResourceSchema` com `company`/`segment`/`city` (`string | null`); adicionar `leadListItemSchema`, `leadListPageSchema` (com cursor), `importLeadsInputSchema` (`{ leads: [...] }`), `importLeadsResultSchema` (`{ imported, updated, rejected: [{ row, phone, reason }] }`), `bulkProspectInputSchema` (`{ phones, force? }`), `bulkProspectResultSchema` (`{ results: [{ phone, outcome, wamid?, reason?, lead }] }`), `resetLeadResultSchema` (`= leadResourceSchema`).
- [x] 4.2 Atualizar `src/management/interface/dto/dto.test.ts` para os schemas novos (casos válidos e inválidos representativos).
- [x] 4.3 Atualizar `src/management/interface/lead.mapper.ts` (`toLeadResource`) para os campos novos.

## 5. Casos de uso

- [x] 5.1 `src/management/application/import-leads.use-case.ts` — `ImportLeadsUseCase`: revalida cada `phone` com `normalizeBrazilPhone`; acumula rejeitados com a linha de origem; colapsa duplicados no lote (última ocorrência vence); `upsertFromImport` dos válidos; retorna `{ imported, updated, rejected }`; recusa lote acima de `MAX_IMPORT_ROWS`. Nunca chama envio de template nem repositório de conversa.
- [x] 5.2 Testes de `ImportLeadsUseCase` com `InMemoryLeadRepository`: lote misto novos/existentes; linhas inválidas não abortam; telefone repetido colapsa; nada é disparado; lote acima do limite rejeitado.
- [x] 5.3 `src/management/application/bulk-prospect-leads.use-case.ts` — `BulkProspectLeadsUseCase`: recebe `phones`/`force`; colapsa duplicados; itera o `ProspectLeadUseCase` existente com concorrência `CONCURRENCY` entre telefones distintos; mapeia sucesso→`sent`, `alreadyProspected`→`skipped`, erros conhecidos→`failed` com motivo; nunca aborta o lote; recusa acima de `MAX_PROSPECT_BATCH`.
- [x] 5.4 Testes de `BulkProspectLeadsUseCase` (fakes já existentes em `test-support`): desfechos mistos `sent`/`skipped`/`failed`; falha de um telefone não interrompe os demais; `force` reenvia para `sent`/`replied`; lote acima do limite → erro; verifica que a idempotência e a auditoria vêm do use-case interno (sem entrada de auditoria própria do lote).
- [x] 5.5 `src/management/application/reset-lead-prospecting.use-case.ts` — `ResetLeadProspectingUseCase`: valida E.164; `findByPhone` → 404 se ausente; `leads.resetProspecting`; auditoria best-effort com `action: "reset_prospecting"`; retorna o lead atualizado. Não usa a `LeadSerialQueue`, não toca a conversa.
- [x] 5.6 Testes de `ResetLeadProspectingUseCase`: reset de `sent`/`replied` → `pending` e carimbos limpos; idempotente sobre `pending`; lead inexistente → erro `LeadNotFoundError`; telefone inválido → `InvalidLeadPhoneError`; falha de auditoria não desfaz o reset.
- [x] 5.7 Adicionar `"reset_prospecting"` ao tipo de ação em `src/management/application/ports/admin-action-audit.port.ts` e ajustar o adapter/persistência de auditoria e seus testes.

## 6. Rotas HTTP

- [x] 6.1 Em `src/management/infrastructure/http/admin-leads.routes.ts`: adicionar `POST /api/leads/import`, `POST /api/leads/prospect`, `POST /api/leads/:leadPhone/reset` e `GET /api/leads` (listagem); validar corpo/params com zod; responder via `replyWithContract`; mapear erros (`InvalidLeadPhoneError`→422, `LeadNotFoundError`→404, lote acima do limite→422); disparo em lote sempre 200 com desfechos no corpo.
- [x] 6.2 `src/management/infrastructure/http/admin-capabilities.routes.ts` — `GET /api/capabilities` devolvendo `{ conversationActions: true, prospecting: true }` conforme as rotas montadas.
- [x] 6.3 Em `src/management/infrastructure/http/register-admin-routes.ts`: instanciar os três use-cases novos e registrar as rotas novas (leads + capabilities) sob o escopo com guarda de sessão.
- [x] 6.4 Estender `src/management/infrastructure/http/admin-leads.routes.test.ts` (e criar teste da rota de capabilities): import (200 com totais + rejeitados; 422 acima do limite; 401 sem sessão); bulk prospect (200 com desfechos mistos; 401 sem sessão); reset (200; 404 lead ausente; 422 telefone inválido; 401 sem sessão); `GET /api/leads` (página, filtros, cursor, 401 sem sessão).

## 7. Testes de integração (servidor)

- [x] 7.1 Estender `src/management/outbound-prospecting.integration.test.ts` (ou criar `lead-import-and-bulk-prospecting.integration.test.ts`): fluxo ponta a ponta — importar um lote (sem disparo), listar via `GET /api/leads`, disparar em lote para uma seleção `pending`, verificar `sent`/`skipped`/`failed`, verificar que a conversa foi semeada só para os `sent`, resetar um lead e reconfirmar que um novo disparo acrescenta turno à conversa existente.

## 8. Frontend — infraestrutura

- [x] 8.1 Adicionar a dependência `xlsx` (SheetJS, versão pinada) ao `wpp_prospector_bot_panel/package.json`.
- [x] 8.2 Em `src/api/contracts.ts`: reexportar/definir os schemas de lead novos a partir de `wpp_prospector_bot_server/contracts`.
- [x] 8.3 Em `src/api/endpoints.ts`: `listLeads(params, signal)`, `importLeads(payload)`, `bulkProspect(payload)`, `resetLead(leadPhone)`; atualizar `getCapabilities` se necessário (o shape não muda).

## 9. Frontend — parser da planilha

- [x] 9.1 `src/features/leads/parse-leads-sheet.ts`: ler o `.xlsx` com SheetJS, localizar a aba `03_Leads_CRM` (fallback por heurística de cabeçalho — `contato|telefone|whatsapp|fone` e `empresa|lead|nome|razão`, case/acento-insensível), extrair `empresa/nome`, `telefone`, `segmento`, `cidade`, normalizar telefone (cópia TS da regra do design D2), retornar `{ valid: LeadDraft[], rejected: { row, raw, reason }[] }`; erro identificável quando a aba/colunas não são reconhecidas.
- [x] 9.2 Testes de `parse-leads-sheet.ts` com um `.xlsx` de fixture (linhas válidas, sem telefone, fixo, número malformado, telefone duplicado) — cobrir também "aba não reconhecida".

## 10. Frontend — tela de leads

- [x] 10.1 `src/features/leads/useLeadList.ts` (query + polling com suspensão em aba oculta, cursor), `useImportLeads.ts`, `useBulkProspect.ts`, `useResetLead.ts` (mutations com invalidação da lista).
- [x] 10.2 `src/features/leads/LeadsTable.tsx`: colunas nome/empresa, telefone, segmento, cidade, estado (badge), primeiro contato; checkbox por linha habilitado só para `pending`/`failed`; ação "Resetar" por linha para `sent`/`replied` (com confirmação).
- [x] 10.3 `src/features/leads/ImportDialog.tsx`: seleção de arquivo → preview (contagem de válidos + lista de rejeitados com motivo) → confirmar → `importLeads` → toast com criados/atualizados → recarregar lista.
- [x] 10.4 `src/features/leads/ProspectConfirmDialog.tsx` + barra de seleção: "Disparar mensagem de abertura (N)" com confirmação indicando a contagem; ao concluir, exibir desfecho por lead e deixar o polling refletir os estados; afordância acoplada à disponibilidade (`useActionAvailability`/`getCapabilities`).
- [x] 10.5 `src/features/leads/LeadsRoute.tsx`: filtros (estado, trecho de telefone, segmento), tabela, botão "Importar planilha", estado vazio que orienta a importar.
- [x] 10.6 `src/routes/router.tsx`: rota `leads`. `src/components/AppShell.tsx`: item de navegação "Leads".
- [x] 10.7 Testes de componente/rota (Testing Library): preview de importação lista rejeitados e não grava antes de confirmar; checkbox desabilitado para `sent`/`replied`; disparo em lote chama o endpoint e mostra desfecho parcial; reset chama o endpoint e a linha volta a `pending`; estado vazio orienta a importar; ação de disparo oculta/desabilitada quando indisponível.

## 11. Configuração e documentação

- [x] 11.1 Atualizar `.env` de exemplo / documentação de ambiente com `PROSPECTING_TEMPLATE_NAME=abertura_lead_obras` e `PROSPECTING_TEMPLATE_LANG=pt_BR` (sem `PARAM_KEYS`).
- [x] 11.2 Nota curta no `CLAUDE.md` / docs sobre o fluxo de importação + disparo em lote e os limites `MAX_IMPORT_ROWS` / `MAX_PROSPECT_BATCH` / `CONCURRENCY`.

## 12. Fechamento

- [x] 12.1 `openspec validate add-lead-import-and-bulk-prospecting --strict` sem erros.
- [x] 12.2 Servidor: `npm run lint`, `npm test`, `npm run build` verdes.
- [x] 12.3 Painel: `npm run lint`, `npm test`, `npm run typecheck`, `npm run build` verdes.
- [x] 12.4 Verificação manual do fluxo com a planilha real `docs/payloads/Plano_ate_primeiro_cliente_v4.xlsx` (importar → listar → disparar seleção → resetar).
