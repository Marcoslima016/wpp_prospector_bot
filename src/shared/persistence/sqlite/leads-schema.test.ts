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
  dflt_value: string | null;
}

describe("migration 0006_leads", () => {
  it("é aplicada por openDatabase junto de 0001..0005", () => {
    db = openDatabase(":memory:");

    const versions = (
      db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: string }>
    ).map((row) => row.version);

    expect(versions).toEqual(expect.arrayContaining(["0006_leads"]));
  });

  it("cria leads com as colunas e a PK (phone) esperadas", () => {
    db = openDatabase(":memory:");

    const columns = db.prepare("PRAGMA table_info(leads)").all() as unknown as ColumnInfo[];
    const byName = new Map(columns.map((c) => [c.name, c]));

    expect([...byName.keys()].sort()).toEqual(
      [
        "phone",
        "display_name",
        "source",
        "notes",
        "prospecting_state",
        "first_contact_wamid",
        "first_contact_at",
        "replied_at",
        "created_at",
        "updated_at",
      ].sort(),
    );

    expect(byName.get("phone")!.pk).toBe(1);
    expect(byName.get("prospecting_state")!.notnull).toBe(1);
    expect(byName.get("prospecting_state")!.dflt_value).toBe("'pending'");
    expect(byName.get("created_at")!.notnull).toBe(1);
    expect(byName.get("updated_at")!.notnull).toBe(1);
    expect(byName.get("display_name")!.notnull).toBe(0);
    expect(byName.get("first_contact_wamid")!.notnull).toBe(0);
  });

  it("cria o índice de consulta por prospecting_state", () => {
    db = openDatabase(":memory:");

    const indexes = (
      db.prepare("PRAGMA index_list(leads)").all() as Array<{ name: string }>
    ).map((row) => row.name);

    expect(indexes).toEqual(expect.arrayContaining(["idx_leads_prospecting_state"]));
  });
});
