-- 0004_whatsapp_conversation_events — fonte WhatsApp da capability `consumption-metrics`.
-- Série temporal append-only: uma linha por janela de conversa de 24 h faturável
-- da Cloud API, deduplicada por `conversation_id` (UNIQUE). O adapter grava com
-- `INSERT ... ON CONFLICT(conversation_id) DO NOTHING` — vários eventos de status
-- da mesma janela não geram linhas extras. Somente INSERT; nunca UPDATE.
-- O custo NÃO é gravado; é derivado na leitura a partir da tabela de preços da
-- Meta versionada em código. `billing_country` e `price_version` ficam
-- registrados para tornar a derivação estável se a tabela mudar depois.
CREATE TABLE whatsapp_conversation_events (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at           TEXT    NOT NULL,          -- ISO-8601 UTC, instante do evento de status
  conversation_id       TEXT    NOT NULL UNIQUE,   -- chave de dedup da janela de 24 h
  recipient_id          TEXT    NOT NULL,          -- telefone do lead
  category              TEXT    NOT NULL,          -- 'marketing'|'utility'|'service'|'authentication'|'unknown'
  origin_type           TEXT    NOT NULL,          -- conversation.origin.type ('' quando ausente)
  pricing_model         TEXT    NOT NULL,          -- pricing.pricing_model ('' quando ausente)
  billable              INTEGER NOT NULL,          -- 0 | 1
  expiration_timestamp  TEXT,                      -- ISO-8601 UTC quando a Meta informa
  billing_country       TEXT    NOT NULL,          -- país-base assumido na escrita (WHATSAPP_BILLING_COUNTRY)
  price_version         TEXT    NOT NULL,          -- versão da tabela de preços Meta vigente na escrita
  recorded_at           TEXT    NOT NULL           -- ISO-8601 UTC, quando a linha foi gravada
);

CREATE INDEX idx_wce_occurred_at ON whatsapp_conversation_events (occurred_at);
CREATE INDEX idx_wce_category    ON whatsapp_conversation_events (category);
CREATE INDEX idx_wce_recipient   ON whatsapp_conversation_events (recipient_id);
