import type { DatabaseSync, StatementSync } from "node:sqlite";
import type {
  LeadContextInput,
  LeadImportInput,
  LeadImportOutcome,
  LeadQueryPage,
  LeadQueryParams,
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

const SELECT_COLUMNS = `
  phone, display_name, source, notes, company, segment, city, prospecting_state,
  first_contact_wamid, first_contact_at, replied_at, imported_at, updated_at
`;

const SELECT_SQL = `SELECT ${SELECT_COLUMNS} FROM leads WHERE phone = ?`;

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

const RESET_PROSPECTING_SQL = `
  UPDATE leads
  SET prospecting_state = 'pending',
      first_contact_wamid = NULL, first_contact_at = NULL, replied_at = NULL,
      updated_at = ?
  WHERE phone = ?
`;

/** Campos de contexto do item de importação → coluna correspondente em `leads`. */
const IMPORT_FIELD_COLUMNS: Array<[keyof LeadImportInput, string]> = [
  ["displayName", "display_name"],
  ["source", "source"],
  ["notes", "notes"],
  ["company", "company"],
  ["segment", "segment"],
  ["city", "city"],
];

interface LeadRow {
  phone: string;
  display_name: string | null;
  source: string | null;
  notes: string | null;
  company: string | null;
  segment: string | null;
  city: string | null;
  prospecting_state: string;
  first_contact_wamid: string | null;
  first_contact_at: string | null;
  replied_at: string | null;
  imported_at: string | null;
  updated_at: string;
}

function toRecord(row: LeadRow): LeadRecord {
  return {
    phone: row.phone,
    displayName: row.display_name,
    source: row.source,
    notes: row.notes,
    company: row.company,
    segment: row.segment,
    city: row.city,
    prospectingState: row.prospecting_state as ProspectingState,
    firstContactWamid: row.first_contact_wamid,
    firstContactAt: row.first_contact_at === null ? null : new Date(row.first_contact_at),
    repliedAt: row.replied_at === null ? null : new Date(row.replied_at),
    importedAt: row.imported_at === null ? null : new Date(row.imported_at),
  };
}

interface LeadCursor {
  /** `COALESCE(imported_at, updated_at)` da última linha da página anterior. */
  k: string;
  /** `phone` da última linha da página anterior. */
  p: string;
}

function encodeCursor(cursor: LeadCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(raw: string): LeadCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as LeadCursor;
    if (typeof parsed?.k !== "string" || typeof parsed?.p !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Adapter de `LeadRepositoryPort` sobre o armazenamento SQL embutido. Uma linha
 * por telefone; `upsert` preserva o `prospecting_state` num re-cadastro. As
 * transições de estado propagam a falha de escrita para quem chama — o caso de
 * uso decide a postura (ex.: `markReplied` é best-effort no tracker).
 *
 * `query` ordena por `(COALESCE(imported_at, updated_at) DESC, phone ASC)` —
 * determinística e estável — com paginação por keyset (o cursor carrega a chave
 * de ordenação da última linha).
 */
export class SqliteLeadRepository implements LeadRepositoryPort {
  private readonly upsertStmt: StatementSync;
  private readonly selectStmt: StatementSync;
  private readonly markProspectedStmt: StatementSync;
  private readonly markFailedStmt: StatementSync;
  private readonly markRepliedStmt: StatementSync;
  private readonly resetStmt: StatementSync;

  constructor(
    private readonly db: DatabaseSync,
    private readonly logger: Logger,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.upsertStmt = db.prepare(UPSERT_SQL);
    this.selectStmt = db.prepare(SELECT_SQL);
    this.markProspectedStmt = db.prepare(MARK_PROSPECTED_SQL);
    this.markFailedStmt = db.prepare(MARK_FAILED_SQL);
    this.markRepliedStmt = db.prepare(MARK_REPLIED_SQL);
    this.resetStmt = db.prepare(RESET_PROSPECTING_SQL);
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

  upsertFromImport(input: LeadImportInput): Promise<LeadImportOutcome> {
    const now = this.clock().toISOString();
    const existed = (this.selectStmt.get(input.phone) as LeadRow | undefined) !== undefined;

    // Só sobrescreve as colunas presentes (chave definida) no item — `undefined`
    // não toca, `null` limpa. Sem `COALESCE`: a planilha é a fonte da verdade.
    const present = IMPORT_FIELD_COLUMNS.filter(([key]) => input[key] !== undefined);

    const insertCols = ["phone", ...present.map(([, col]) => col), "prospecting_state", "imported_at", "created_at", "updated_at"];
    const insertPlaceholders = insertCols.map(() => "?");
    const insertArgs: Array<string | null> = [
      input.phone,
      ...present.map(([key]) => (input[key] ?? null) as string | null),
      "pending",
      now,
      now,
      now,
    ];

    const updateAssignments = [
      ...present.map(([, col]) => `${col} = excluded.${col}`),
      "imported_at = excluded.imported_at",
      "updated_at = excluded.updated_at",
    ];

    const sql = `
      INSERT INTO leads (${insertCols.join(", ")})
      VALUES (${insertPlaceholders.join(", ")})
      ON CONFLICT(phone) DO UPDATE SET ${updateAssignments.join(", ")}
    `;
    this.db.prepare(sql).run(...insertArgs);

    const row = this.selectStmt.get(input.phone) as LeadRow | undefined;
    if (row === undefined) {
      throw new Error(`Lead ${input.phone} não encontrado após upsertFromImport`);
    }
    return Promise.resolve({ lead: toRecord(row), existed });
  }

  findByPhone(phone: string): Promise<LeadRecord | null> {
    const row = this.selectStmt.get(phone) as LeadRow | undefined;
    return Promise.resolve(row === undefined ? null : toRecord(row));
  }

  query(params: LeadQueryParams): Promise<LeadQueryPage> {
    const where: string[] = [];
    const args: Array<string | number> = [];

    if (params.state !== undefined) {
      where.push("prospecting_state = ?");
      args.push(params.state);
    }
    if (params.phoneContains !== undefined && params.phoneContains !== "") {
      where.push("instr(phone, ?) > 0");
      args.push(params.phoneContains);
    }
    if (params.segment !== undefined && params.segment !== "") {
      where.push("segment = ?");
      args.push(params.segment);
    }

    if (params.cursor !== undefined) {
      const cursor = decodeCursor(params.cursor);
      if (cursor) {
        where.push(
          "(COALESCE(imported_at, updated_at) < ? OR (COALESCE(imported_at, updated_at) = ? AND phone > ?))",
        );
        args.push(cursor.k, cursor.k, cursor.p);
      }
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `SELECT ${SELECT_COLUMNS}
           FROM leads
           ${whereSql}
          ORDER BY COALESCE(imported_at, updated_at) DESC, phone ASC
          LIMIT ?`,
      )
      .all(...args, params.limit + 1) as unknown as LeadRow[];

    const hasMore = rows.length > params.limit;
    const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
    const last = pageRows.at(-1);

    return Promise.resolve({
      items: pageRows.map(toRecord),
      nextCursor:
        hasMore && last
          ? encodeCursor({ k: last.imported_at ?? last.updated_at, p: last.phone })
          : null,
    });
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

  resetProspecting(phone: string): Promise<boolean> {
    const result = this.resetStmt.run(this.clock().toISOString(), phone);
    if (result.changes === 0) {
      this.logger.warn("resetProspecting não encontrou o lead", { phone });
    }
    return Promise.resolve(result.changes > 0);
  }
}
