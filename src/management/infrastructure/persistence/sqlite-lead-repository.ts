import type { DatabaseSync, StatementSync } from "node:sqlite";
import type {
  LeadContextInput,
  LeadRecord,
  LeadRepositoryPort,
  ProspectingState,
} from "../../application/ports/lead-repository.port.ts";
import type { Logger } from "../../application/ports/logger.port.ts";

const UPSERT_SQL = `
  INSERT INTO leads (phone, display_name, source, notes, prospecting_state, created_at, updated_at)
  VALUES (?, ?, ?, ?, 'pending', ?, ?)
  ON CONFLICT(phone) DO UPDATE SET
    display_name = COALESCE(excluded.display_name, leads.display_name),
    source       = COALESCE(excluded.source, leads.source),
    notes        = COALESCE(excluded.notes, leads.notes),
    updated_at   = excluded.updated_at
`;

const SELECT_SQL = `
  SELECT phone, display_name, source, notes, prospecting_state,
         first_contact_wamid, first_contact_at, replied_at
  FROM leads
  WHERE phone = ?
`;

const MARK_PROSPECTED_SQL = `
  UPDATE leads
  SET prospecting_state = 'sent', first_contact_wamid = ?, first_contact_at = ?, updated_at = ?
  WHERE phone = ?
`;

const MARK_FAILED_SQL = `
  UPDATE leads
  SET prospecting_state = 'failed', updated_at = ?
  WHERE phone = ?
`;

const MARK_REPLIED_SQL = `
  UPDATE leads
  SET prospecting_state = 'replied', replied_at = ?, updated_at = ?
  WHERE phone = ? AND prospecting_state = 'sent'
`;

interface LeadRow {
  phone: string;
  display_name: string | null;
  source: string | null;
  notes: string | null;
  prospecting_state: string;
  first_contact_wamid: string | null;
  first_contact_at: string | null;
  replied_at: string | null;
}

function toRecord(row: LeadRow): LeadRecord {
  return {
    phone: row.phone,
    displayName: row.display_name,
    source: row.source,
    notes: row.notes,
    prospectingState: row.prospecting_state as ProspectingState,
    firstContactWamid: row.first_contact_wamid,
    firstContactAt: row.first_contact_at === null ? null : new Date(row.first_contact_at),
    repliedAt: row.replied_at === null ? null : new Date(row.replied_at),
  };
}

/**
 * Adapter de `LeadRepositoryPort` sobre o armazenamento SQL embutido. Uma linha
 * por telefone; `upsert` preserva o `prospecting_state` num re-cadastro. As
 * transições de estado propagam a falha de escrita para quem chama — o caso de
 * uso decide a postura (ex.: `markReplied` é best-effort no tracker).
 */
export class SqliteLeadRepository implements LeadRepositoryPort {
  private readonly upsertStmt: StatementSync;
  private readonly selectStmt: StatementSync;
  private readonly markProspectedStmt: StatementSync;
  private readonly markFailedStmt: StatementSync;
  private readonly markRepliedStmt: StatementSync;

  constructor(
    db: DatabaseSync,
    private readonly logger: Logger,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.upsertStmt = db.prepare(UPSERT_SQL);
    this.selectStmt = db.prepare(SELECT_SQL);
    this.markProspectedStmt = db.prepare(MARK_PROSPECTED_SQL);
    this.markFailedStmt = db.prepare(MARK_FAILED_SQL);
    this.markRepliedStmt = db.prepare(MARK_REPLIED_SQL);
  }

  upsert(input: LeadContextInput): Promise<LeadRecord> {
    const now = this.clock().toISOString();
    this.upsertStmt.run(
      input.phone,
      input.displayName ?? null,
      input.source ?? null,
      input.notes ?? null,
      now,
      now,
    );
    const row = this.selectStmt.get(input.phone) as LeadRow | undefined;
    if (row === undefined) {
      // Inalcançável: acabamos de inserir/atualizar a linha.
      throw new Error(`Lead ${input.phone} não encontrado após upsert`);
    }
    return Promise.resolve(toRecord(row));
  }

  findByPhone(phone: string): Promise<LeadRecord | null> {
    const row = this.selectStmt.get(phone) as LeadRow | undefined;
    return Promise.resolve(row === undefined ? null : toRecord(row));
  }

  markProspected(phone: string, wamid: string, at: Date): Promise<void> {
    const result = this.markProspectedStmt.run(
      wamid,
      at.toISOString(),
      this.clock().toISOString(),
      phone,
    );
    if (result.changes === 0) {
      this.logger.warn("markProspected não encontrou o lead", { phone });
    }
    return Promise.resolve();
  }

  markFailed(phone: string, at: Date): Promise<void> {
    const result = this.markFailedStmt.run(at.toISOString(), phone);
    if (result.changes === 0) {
      this.logger.warn("markFailed não encontrou o lead", { phone });
    }
    return Promise.resolve();
  }

  markReplied(phone: string, at: Date): Promise<void> {
    // WHERE ... AND prospecting_state = 'sent' — no-op silencioso fora desse estado.
    this.markRepliedStmt.run(at.toISOString(), this.clock().toISOString(), phone);
    return Promise.resolve();
  }
}
