-- 0007_leads_import_fields — campos de contexto ampliados para a importação de
-- leads por planilha (capability `outbound-prospecting`).
-- Aditiva: colunas nullable, sem backfill. `imported_at` fica NULL para o
-- cadastro manual (`POST /admin/api/leads`) e recebe o instante da importação
-- em lote (`POST /admin/api/leads/import`).
-- Numa re-importação do mesmo telefone os valores da planilha SOBRESCREVEM os do
-- banco (diferente do `upsert` manual, que só preenche campo vazio).
ALTER TABLE leads ADD COLUMN company     TEXT;
ALTER TABLE leads ADD COLUMN segment     TEXT;
ALTER TABLE leads ADD COLUMN city        TEXT;
ALTER TABLE leads ADD COLUMN imported_at TEXT;   -- ISO-8601 UTC; NULL p/ cadastro manual

CREATE INDEX idx_leads_segment ON leads (segment);
