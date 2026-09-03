-- 0005_admin_action_events — trilha de auditoria das ações de operação do painel
-- de gestão (capability `management-api`).
-- Série append-only: uma linha por ação de operador aplicada com sucesso
-- (handoff, resume, envio de mensagem avulsa). Somente INSERT; nunca UPDATE.
-- A gravação é best-effort do lado da aplicação — uma falha aqui não desfaz a
-- ação já persistida na conversa. `actor` fica fixo em 'operator' enquanto não
-- houver múltiplos usuários.
CREATE TABLE admin_action_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT NOT NULL,   -- ISO-8601 UTC, instante em que a ação ocorreu
  actor       TEXT NOT NULL,   -- 'operator' por ora
  action      TEXT NOT NULL,   -- 'handoff' | 'resume' | 'send-message'
  lead_phone  TEXT NOT NULL,   -- telefone E.164 do lead afetado
  recorded_at TEXT NOT NULL    -- ISO-8601 UTC, quando a linha foi gravada
);

CREATE INDEX idx_admin_action_events_occurred_at ON admin_action_events (occurred_at);
CREATE INDEX idx_admin_action_events_lead        ON admin_action_events (lead_phone);
