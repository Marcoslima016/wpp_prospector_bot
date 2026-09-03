import type { DatabaseSync, StatementSync } from "node:sqlite";
import type {
  AdminActionAuditPort,
  AdminActionEntry,
} from "../../application/ports/admin-action-audit.port.ts";
import type { Logger } from "../../application/ports/logger.port.ts";

const INSERT_SQL = `
  INSERT INTO admin_action_events (occurred_at, actor, action, lead_phone, recorded_at)
  VALUES (?, ?, ?, ?, ?)
`;

/**
 * Adapter de `AdminActionAuditPort` sobre o armazenamento SQL embutido. Grava uma
 * linha append-only por ação de operação. Propaga a falha de escrita para quem
 * chama — o caso de uso decide tratá-la como best-effort (log + segue).
 */
export class SqliteAdminActionAudit implements AdminActionAuditPort {
  private readonly insert: StatementSync;

  constructor(
    db: DatabaseSync,
    private readonly logger: Logger,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.insert = db.prepare(INSERT_SQL);
  }

  record(entry: AdminActionEntry): Promise<void> {
    this.insert.run(
      entry.occurredAt.toISOString(),
      entry.actor,
      entry.action,
      entry.leadPhone,
      this.clock().toISOString(),
    );
    this.logger.info("Ação de operação registrada na auditoria", {
      action: entry.action,
      leadPhone: entry.leadPhone,
    });
    return Promise.resolve();
  }
}
