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

const INSERT = `INSERT INTO whatsapp_conversation_events
  (occurred_at, conversation_id, recipient_id, category, origin_type, pricing_model,
   billable, expiration_timestamp, billing_country, price_version, recorded_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function insert(conversationId: string, expiration: string | null = null): void {
  db!
    .prepare(INSERT)
    .run(
      "2026-09-02T12:00:00.000Z",
      conversationId,
      "5511999999999",
      "marketing",
      "marketing",
      "CBP",
      1,
      expiration,
      "BR",
      "2026-09-02",
      "2026-09-02T12:00:01.000Z",
    );
}

describe("migration 0004_whatsapp_conversation_events", () => {
  it("é aplicada por openDatabase e cria a tabela append-only com o esquema esperado", () => {
    db = openDatabase(":memory:");

    const versions = (
      db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: string }>
    ).map((row) => row.version);
    expect(versions).toContain("0004_whatsapp_conversation_events");

    const columns = db
      .prepare("PRAGMA table_info(whatsapp_conversation_events)")
      .all() as unknown as ColumnInfo[];
    const byName = new Map(columns.map((c) => [c.name, c]));

    expect([...byName.keys()].sort()).toEqual(
      [
        "billable",
        "billing_country",
        "category",
        "conversation_id",
        "expiration_timestamp",
        "id",
        "occurred_at",
        "origin_type",
        "price_version",
        "pricing_model",
        "recipient_id",
        "recorded_at",
      ].sort(),
    );

    for (const required of [
      "occurred_at",
      "conversation_id",
      "recipient_id",
      "category",
      "origin_type",
      "pricing_model",
      "billable",
      "billing_country",
      "price_version",
      "recorded_at",
    ]) {
      expect(byName.get(required)!.notnull).toBe(1);
    }
    // Único campo opcional.
    expect(byName.get("expiration_timestamp")!.notnull).toBe(0);
  });

  it("cria os índices de agregação (occurred_at, category, recipient_id)", () => {
    db = openDatabase(":memory:");

    const indexes = (
      db
        .prepare("PRAGMA index_list(whatsapp_conversation_events)")
        .all() as Array<{ name: string }>
    ).map((row) => row.name);

    expect(indexes).toEqual(
      expect.arrayContaining(["idx_wce_occurred_at", "idx_wce_category", "idx_wce_recipient"]),
    );
  });

  it("impõe UNIQUE(conversation_id)", () => {
    db = openDatabase(":memory:");

    insert("conv-1");
    expect(() => insert("conv-1")).toThrow();
    expect(() => insert("conv-2")).not.toThrow();
  });

  it("aceita expiration_timestamp NULL", () => {
    db = openDatabase(":memory:");
    expect(() => insert("conv-3", null)).not.toThrow();
  });
});
