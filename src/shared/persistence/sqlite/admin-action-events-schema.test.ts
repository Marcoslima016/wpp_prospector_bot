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

describe("migration 0005_admin_action_events", () => {
  it("é aplicada por openDatabase junto de 0001..0004", () => {
    db = openDatabase(":memory:");

    const versions = (
      db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: string }>
    ).map((row) => row.version);

    expect(versions).toEqual(expect.arrayContaining(["0005_admin_action_events"]));
  });

  it("cria admin_action_events com as colunas e a PK esperadas", () => {
    db = openDatabase(":memory:");

    const columns = db
      .prepare("PRAGMA table_info(admin_action_events)")
      .all() as unknown as ColumnInfo[];
    const byName = new Map(columns.map((c) => [c.name, c]));

    expect([...byName.keys()].sort()).toEqual(
      ["action", "actor", "id", "lead_phone", "occurred_at", "recorded_at"].sort(),
    );

    expect(byName.get("id")!.pk).toBe(1);
    expect(byName.get("occurred_at")!.notnull).toBe(1);
    expect(byName.get("actor")!.notnull).toBe(1);
    expect(byName.get("action")!.notnull).toBe(1);
    expect(byName.get("lead_phone")!.notnull).toBe(1);
    expect(byName.get("recorded_at")!.notnull).toBe(1);
  });

  it("cria os índices de consulta (occurred_at, lead_phone)", () => {
    db = openDatabase(":memory:");

    const indexes = (
      db.prepare("PRAGMA index_list(admin_action_events)").all() as Array<{ name: string }>
    ).map((row) => row.name);

    expect(indexes).toEqual(
      expect.arrayContaining([
        "idx_admin_action_events_occurred_at",
        "idx_admin_action_events_lead",
      ]),
    );
  });
});
