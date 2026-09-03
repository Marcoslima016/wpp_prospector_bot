-- 0003_conversation_index — projeção de leitura da capability `management-api`.
-- Índice derivado das conversas (1 arquivo JSON por lead é a fonte da verdade).
-- Uma linha por lead, sobrescrita a cada `save()` do repositório. Serve apenas
-- a listagem/filtro/paginação e os contadores do "agora"; o detalhe da conversa
-- é lido do arquivo, não daqui. Reconstruída no boot quando estiver vazia/stale.
CREATE TABLE conversation_index (
  lead_phone          TEXT    PRIMARY KEY,
  state               TEXT    NOT NULL,           -- 'active' | 'ended' | 'awaitingHuman'
  lead_intent         TEXT    NOT NULL,
  lead_qualification  TEXT,                       -- NULL enquanto não qualificado
  turn_count          INTEGER NOT NULL DEFAULT 0,
  last_activity_at    TEXT,                       -- ISO-8601 UTC do último turno; NULL se sem turnos
  has_pending_inbound INTEGER NOT NULL DEFAULT 0, -- 0 | 1
  quoted_plan         TEXT,                       -- último plano citado, ou NULL
  updated_at          TEXT    NOT NULL            -- ISO-8601 UTC da última escrita nesta linha
);

CREATE INDEX idx_conversation_index_state       ON conversation_index (state);
CREATE INDEX idx_conversation_index_lead_intent ON conversation_index (lead_intent);
CREATE INDEX idx_conversation_index_activity    ON conversation_index (last_activity_at);
