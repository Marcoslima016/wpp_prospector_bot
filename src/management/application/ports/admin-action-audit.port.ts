/** Tipo de ação de operação sobre uma conversa, registrada na auditoria. */
export type AdminActionType = "handoff" | "resume" | "send-message";

export interface AdminActionEntry {
  /** Autor da ação. Fixo em `"operator"` enquanto não houver múltiplos usuários. */
  actor: string;
  action: AdminActionType;
  /** Telefone E.164 do lead afetado. */
  leadPhone: string;
  /** Instante em que a ação ocorreu. */
  occurredAt: Date;
}

/**
 * Trilha de auditoria append-only das ações de operação do painel de gestão.
 * A gravação é best-effort do ponto de vista do caso de uso: uma falha aqui não
 * desfaz a ação já aplicada na conversa.
 */
export interface AdminActionAuditPort {
  record(entry: AdminActionEntry): Promise<void>;
}
