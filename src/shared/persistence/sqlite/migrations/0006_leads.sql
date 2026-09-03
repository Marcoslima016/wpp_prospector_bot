-- 0006_leads — cadastro de leads para prospecção ativa (capability `outbound-prospecting`).
-- Uma linha por lead, chaveada pelo telefone E.164 (dedup por telefone de graça).
-- Registro operacional paralelo: NÃO é a fonte da verdade da conversa (que segue
-- em 1 arquivo JSON por lead). `prospecting_state` evolui com o resultado do
-- primeiro contato e com o primeiro inbound subsequente:
--   pending  → lead cadastrado, primeiro contato ainda não disparado
--   sent     → template de primeiro contato aceito pelo gateway
--   replied  → o lead respondeu pela primeira vez após o primeiro contato
--   failed   → o gateway rejeitou o envio do primeiro contato
-- `first_contact_wamid` correlaciona o envio aos eventos de status/precificação
-- da Meta (capability `consumption-metrics`).
CREATE TABLE leads (
  phone               TEXT    PRIMARY KEY,                    -- E.164
  display_name        TEXT,                                   -- contexto opcional
  source              TEXT,                                   -- origem do lead (opcional)
  notes               TEXT,                                   -- anotações livres (opcional)
  prospecting_state   TEXT    NOT NULL DEFAULT 'pending',     -- pending|sent|replied|failed
  first_contact_wamid TEXT,                                   -- wamid do template de primeiro contato
  first_contact_at    TEXT,                                   -- ISO-8601 UTC, quando foi para 'sent'
  replied_at          TEXT,                                   -- ISO-8601 UTC do primeiro inbound pós-contato
  created_at          TEXT    NOT NULL,                       -- ISO-8601 UTC do cadastro
  updated_at          TEXT    NOT NULL                        -- ISO-8601 UTC da última escrita nesta linha
);

CREATE INDEX idx_leads_prospecting_state ON leads (prospecting_state);
