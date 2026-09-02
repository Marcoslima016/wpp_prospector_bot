-- 0002_llm_usage_events — fonte LLM da capability `consumption-metrics`.
-- Série temporal append-only: uma linha por chamada real ao LLM (geração da
-- decisão e extração de sinais). Somente INSERT — nunca UPDATE de acumulado. O
-- custo NÃO é gravado; é derivado na leitura a partir da tabela de preços
-- versionada em código. `price_version` fica registrado para desempate/rastreio.
CREATE TABLE llm_usage_events (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at        TEXT    NOT NULL,           -- ISO-8601 UTC, instante da chamada
  call_type          TEXT    NOT NULL,           -- 'reply-generation' | 'signal-extraction'
  lead_phone         TEXT,                       -- NULL quando não há lead associado
  model              TEXT    NOT NULL,           -- modelo efetivamente usado
  input_tokens       INTEGER NOT NULL,
  output_tokens      INTEGER NOT NULL,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  request_id         TEXT,                       -- request-id da Anthropic quando disponível
  price_version      TEXT    NOT NULL,           -- versão da tabela de preços vigente na escrita
  recorded_at        TEXT    NOT NULL            -- ISO-8601 UTC, quando a linha foi gravada
);

CREATE INDEX idx_llm_usage_events_occurred_at ON llm_usage_events (occurred_at);
CREATE INDEX idx_llm_usage_events_lead        ON llm_usage_events (lead_phone);
CREATE INDEX idx_llm_usage_events_model       ON llm_usage_events (model);
