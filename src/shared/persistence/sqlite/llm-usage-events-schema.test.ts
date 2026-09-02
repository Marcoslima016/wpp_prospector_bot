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
  type: string;
  notnull: number;
  dflt_value: string | null;
}

describe("migration 0002_llm_usage_events", () => {
  it("é aplicada por openDatabase e cria a tabela append-only com o esquema esperado", () => {
    db = openDatabase(":memory:");

    const versions = (
      db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: string }>
    ).map((row) => row.version);
    expect(versions).toContain("0002_llm_usage_events");

    const columns = db
      .prepare("PRAGMA table_info(llm_usage_events)")
      .all() as unknown as ColumnInfo[];
    const byName = new Map(columns.map((c) => [c.name, c]));

    expect([...byName.keys()].sort()).toEqual(
      [
        "cache_read_tokens",
        "cache_write_tokens",
        "call_type",
        "id",
        "input_tokens",
        "lead_phone",
        "model",
        "occurred_at",
        "output_tokens",
        "price_version",
        "recorded_at",
        "request_id",
      ].sort(),
    );

    // NOT NULL nos campos obrigatórios; lead_phone e request_id são opcionais.
    expect(byName.get("occurred_at")!.notnull).toBe(1);
    expect(byName.get("call_type")!.notnull).toBe(1);
    expect(byName.get("model")!.notnull).toBe(1);
    expect(byName.get("price_version")!.notnull).toBe(1);
    expect(byName.get("lead_phone")!.notnull).toBe(0);
    expect(byName.get("request_id")!.notnull).toBe(0);

    // Defaults 0 nos contadores de cache.
    expect(byName.get("cache_read_tokens")!.dflt_value).toBe("0");
    expect(byName.get("cache_write_tokens")!.dflt_value).toBe("0");
  });

  it("cria os índices de agregação (occurred_at, lead_phone, model)", () => {
    db = openDatabase(":memory:");

    const indexes = (
      db.prepare("PRAGMA index_list(llm_usage_events)").all() as Array<{ name: string }>
    ).map((row) => row.name);

    expect(indexes).toEqual(
      expect.arrayContaining([
        "idx_llm_usage_events_occurred_at",
        "idx_llm_usage_events_lead",
        "idx_llm_usage_events_model",
      ]),
    );
  });

  it("aceita lead_phone NULL (chamada sem lead associado)", () => {
    db = openDatabase(":memory:");

    expect(() =>
      db!
        .prepare(
          `INSERT INTO llm_usage_events
             (occurred_at, call_type, lead_phone, model, input_tokens, output_tokens,
              cache_read_tokens, cache_write_tokens, request_id, price_version, recorded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "2026-09-02T12:00:00.000Z",
          "signal-extraction",
          null,
          "claude-haiku-4-5-20251001",
          10,
          5,
          0,
          0,
          null,
          "2026-09-02",
          "2026-09-02T12:00:01.000Z",
        ),
    ).not.toThrow();
  });
});
