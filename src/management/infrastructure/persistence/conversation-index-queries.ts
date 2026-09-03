import type { DatabaseSync } from "node:sqlite";
import type {
  ConversationListItem,
  ConversationListPage,
} from "../../interface/dto/conversation.dto.ts";
import { CONVERSATION_STATES } from "../../interface/dto/common.ts";
import { EMPTY_OVERVIEW, type Overview } from "../../interface/dto/overview.dto.ts";

export interface ConversationListParams {
  state?: string | undefined;
  leadIntent?: string | undefined;
  /** Trecho do telefone (match parcial). */
  phone?: string | undefined;
  /** Faixa de última atividade — início inclusivo, fim exclusivo (ISO 8601). */
  activityFrom?: string | undefined;
  activityTo?: string | undefined;
  limit: number;
  cursor?: string | undefined;
}

interface IndexRow {
  lead_phone: string;
  state: string;
  lead_intent: string;
  lead_qualification: string | null;
  turn_count: number;
  last_activity_at: string | null;
  has_pending_inbound: number;
  quoted_plan: string | null;
}

interface Cursor {
  /** `COALESCE(last_activity_at, '')` da última linha da página anterior. */
  a: string;
  /** `lead_phone` da última linha da página anterior. */
  p: string;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(raw: string): Cursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
    if (typeof parsed?.a !== "string" || typeof parsed?.p !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function toItem(row: IndexRow): ConversationListItem {
  return {
    leadPhone: row.lead_phone,
    state: row.state as ConversationListItem["state"],
    leadIntent: row.lead_intent as ConversationListItem["leadIntent"],
    leadQualification: row.lead_qualification as ConversationListItem["leadQualification"],
    turnCount: row.turn_count,
    lastActivityAt: row.last_activity_at,
    hasPendingInbound: row.has_pending_inbound === 1,
    quotedPlan: row.quoted_plan as ConversationListItem["quotedPlan"],
  };
}

/**
 * Consultas de leitura sobre `conversation_index` — base para `GET /admin/api/
 * conversations` e `GET /admin/api/stats/overview`. Recebe a conexão preparada
 * por injeção; não abre conexão nem expõe rota.
 *
 * Ordenação estável por `(last_activity_at DESC, lead_phone DESC)` com
 * `COALESCE(last_activity_at, '')` para jogar as conversas sem turno para o fim.
 * Paginação por keyset: o cursor carrega a chave de ordenação da última linha.
 */
export class ConversationIndexQueries {
  constructor(private readonly db: DatabaseSync) {}

  list(params: ConversationListParams): ConversationListPage {
    const where: string[] = [];
    const args: Array<string | number> = [];

    if (params.state !== undefined) {
      where.push("state = ?");
      args.push(params.state);
    }
    if (params.leadIntent !== undefined) {
      where.push("lead_intent = ?");
      args.push(params.leadIntent);
    }
    if (params.phone !== undefined && params.phone !== "") {
      where.push("instr(lead_phone, ?) > 0");
      args.push(params.phone);
    }
    if (params.activityFrom !== undefined) {
      where.push("last_activity_at >= ?");
      args.push(params.activityFrom);
    }
    if (params.activityTo !== undefined) {
      where.push("last_activity_at < ?");
      args.push(params.activityTo);
    }

    if (params.cursor !== undefined) {
      const cursor = decodeCursor(params.cursor);
      if (cursor) {
        where.push(
          "(COALESCE(last_activity_at, '') < ? OR (COALESCE(last_activity_at, '') = ? AND lead_phone < ?))",
        );
        args.push(cursor.a, cursor.a, cursor.p);
      }
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `SELECT lead_phone, state, lead_intent, lead_qualification, turn_count,
                last_activity_at, has_pending_inbound, quoted_plan
           FROM conversation_index
           ${whereSql}
          ORDER BY COALESCE(last_activity_at, '') DESC, lead_phone DESC
          LIMIT ?`,
      )
      .all(...args, params.limit + 1) as unknown as IndexRow[];

    const hasMore = rows.length > params.limit;
    const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
    const last = pageRows.at(-1);

    return {
      items: pageRows.map(toItem),
      pageSize: params.limit,
      nextCursor:
        hasMore && last
          ? encodeCursor({ a: last.last_activity_at ?? "", p: last.lead_phone })
          : null,
    };
  }

  overview(): Overview {
    const byState = this.db
      .prepare("SELECT state, COUNT(*) AS n FROM conversation_index GROUP BY state")
      .all() as unknown as Array<{ state: string; n: number }>;

    const conversationsByState = { ...EMPTY_OVERVIEW.conversationsByState };
    let totalLeads = 0;
    for (const row of byState) {
      totalLeads += row.n;
      if ((CONVERSATION_STATES as readonly string[]).includes(row.state)) {
        conversationsByState[row.state as keyof Overview["conversationsByState"]] = row.n;
      }
    }

    const pending = this.db
      .prepare("SELECT COUNT(*) AS n FROM conversation_index WHERE has_pending_inbound = 1")
      .get() as { n: number };

    return { conversationsByState, totalLeads, pendingInbound: pending.n };
  }
}
