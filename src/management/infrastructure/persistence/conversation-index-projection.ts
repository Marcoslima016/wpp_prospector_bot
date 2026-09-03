import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { Conversation } from "../../../conversation-engine/domain/conversation.ts";

const UPSERT_SQL = `
  INSERT INTO conversation_index
    (lead_phone, state, lead_intent, lead_qualification, turn_count,
     last_activity_at, has_pending_inbound, quoted_plan, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(lead_phone) DO UPDATE SET
    state               = excluded.state,
    lead_intent         = excluded.lead_intent,
    lead_qualification  = excluded.lead_qualification,
    turn_count          = excluded.turn_count,
    last_activity_at    = excluded.last_activity_at,
    has_pending_inbound = excluded.has_pending_inbound,
    quoted_plan         = excluded.quoted_plan,
    updated_at          = excluded.updated_at
`;

interface IndexRow {
  lead_phone: string;
  state: string;
  lead_intent: string;
  lead_qualification: string | null;
  turn_count: number;
  last_activity_at: string | null;
  has_pending_inbound: number;
  quoted_plan: string | null;
  updated_at: string;
}

/** Deriva a linha do índice a partir do agregado — sem tocar SQLite. */
export function deriveIndexRow(conversation: Conversation, now: Date): IndexRow {
  const lastTurn = conversation.turns.at(-1);
  return {
    lead_phone: conversation.leadPhone,
    state: conversation.state,
    lead_intent: conversation.leadIntent,
    lead_qualification: conversation.leadQualification,
    turn_count: conversation.turns.length,
    last_activity_at: lastTurn ? lastTurn.timestamp.toISOString() : null,
    has_pending_inbound: conversation.pendingInboundTurns.length > 0 ? 1 : 0,
    quoted_plan: conversation.quotedPlan,
    updated_at: now.toISOString(),
  };
}

/**
 * Mantém a tabela derivada `conversation_index` em dia. O arquivo por lead
 * continua a fonte da verdade; esta projeção só alimenta listagem/filtro/
 * paginação e os contadores. Recebe a conexão já preparada por injeção.
 */
export class ConversationIndexProjection {
  private readonly upsertStmt: StatementSync;

  constructor(
    private readonly db: DatabaseSync,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.upsertStmt = db.prepare(UPSERT_SQL);
  }

  /** UPSERT de uma linha a partir do agregado salvo. */
  upsertFromConversation(conversation: Conversation): void {
    const row = deriveIndexRow(conversation, this.clock());
    this.upsertStmt.run(
      row.lead_phone,
      row.state,
      row.lead_intent,
      row.lead_qualification,
      row.turn_count,
      row.last_activity_at,
      row.has_pending_inbound,
      row.quoted_plan,
      row.updated_at,
    );
  }

  /**
   * `true` quando o índice precisa ser reconstruído no boot. Hoje: tabela vazia.
   * (Marcadores de staleness por `mtime` podem entrar aqui depois, se o volume
   * de conversas justificar.)
   */
  isEmptyOrStale(): boolean {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM conversation_index").get() as {
      n: number;
    };
    return row.n === 0;
  }

  /**
   * Varre `conversationsDir` uma vez, substitui o conteúdo do índice pelo estado
   * atual dos arquivos e devolve quantas conversas foram indexadas. Tudo em uma
   * transação — se falhar no meio, nada persiste.
   */
  async rebuildFromDir(conversationsDir: string): Promise<number> {
    let entries: string[];
    try {
      entries = await readdir(conversationsDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }

    const conversations: Conversation[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      let raw: string;
      try {
        raw = await readFile(join(conversationsDir, entry), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      conversations.push(Conversation.fromJSON(JSON.parse(raw)));
    }

    this.db.exec("BEGIN");
    try {
      this.db.exec("DELETE FROM conversation_index");
      for (const conversation of conversations) {
        this.upsertFromConversation(conversation);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    return conversations.length;
  }
}
