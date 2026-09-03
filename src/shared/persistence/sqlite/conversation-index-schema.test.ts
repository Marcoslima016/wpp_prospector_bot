import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./open-database.ts";

let db: DatabaseSync | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

interface ColumnInfo {
  name: string;
  notnull: number;
  pk: number;
}

describe("migration 0003_conversation_index", () => {
  it("é aplicada por openDatabase junto de 0001..0002", () => {
    db = openDatabase(":memory:");

    const versions = (
      db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: string }>
    ).map((row) => row.version);

    expect(versions).toEqual(
      expect.arrayContaining(["0001_init", "0002_llm_usage_events", "0003_conversation_index"]),
    );
  });

  it("cria conversation_index com as colunas e a PK esperadas", () => {
    db = openDatabase(":memory:");

    const columns = db
      .prepare("PRAGMA table_info(conversation_index)")
      .all() as unknown as ColumnInfo[];
    const byName = new Map(columns.map((c) => [c.name, c]));

    expect([...byName.keys()].sort()).toEqual(
      [
        "has_pending_inbound",
        "last_activity_at",
        "lead_intent",
        "lead_phone",
        "lead_qualification",
        "quoted_plan",
        "state",
        "turn_count",
        "updated_at",
      ].sort(),
    );

    expect(byName.get("lead_phone")!.pk).toBe(1);
    expect(byName.get("state")!.notnull).toBe(1);
    expect(byName.get("lead_intent")!.notnull).toBe(1);
    expect(byName.get("updated_at")!.notnull).toBe(1);
    expect(byName.get("lead_qualification")!.notnull).toBe(0);
    expect(byName.get("last_activity_at")!.notnull).toBe(0);
  });

  it("cria os índices de filtro (state, lead_intent, last_activity_at)", () => {
    db = openDatabase(":memory:");

    const indexes = (
      db.prepare("PRAGMA index_list(conversation_index)").all() as Array<{ name: string }>
    ).map((row) => row.name);

    expect(indexes).toEqual(
      expect.arrayContaining([
        "idx_conversation_index_state",
        "idx_conversation_index_lead_intent",
        "idx_conversation_index_activity",
      ]),
    );
  });
});
