import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "./migration-runner.ts";
import { openDatabase } from "./open-database.ts";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

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
        // adicionadas em 0007_leads_import_fields
        "company",
        "segment",
        "city",
        "imported_at",
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

describe("migration 0007_leads_import_fields", () => {
  it("é aplicada por openDatabase junto de 0001..0006", () => {
    db = openDatabase(":memory:");

    const versions = (
      db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: string }>
    ).map((row) => row.version);

    expect(versions).toEqual(expect.arrayContaining(["0007_leads_import_fields"]));
  });

  it("adiciona company/segment/city/imported_at (todas nullable) em leads", () => {
    db = openDatabase(":memory:");

    const columns = db.prepare("PRAGMA table_info(leads)").all() as unknown as ColumnInfo[];
    const byName = new Map(columns.map((c) => [c.name, c]));

    for (const name of ["company", "segment", "city", "imported_at"]) {
      expect(byName.has(name), `coluna ${name}`).toBe(true);
      expect(byName.get(name)!.notnull, `coluna ${name} nullable`).toBe(0);
    }
  });

  it("cria o índice de consulta por segment", () => {
    db = openDatabase(":memory:");

    const indexes = (
      db.prepare("PRAGMA index_list(leads)").all() as Array<{ name: string }>
    ).map((row) => row.name);

    expect(indexes).toEqual(expect.arrayContaining(["idx_leads_segment"]));
  });

  it("um banco só com 0001..0006 migra para 0007 sem erro", () => {
    const dir = mkdtempSync(join(tmpdir(), "leads-0007-"));
    try {
      for (const file of readdirSync(MIGRATIONS_DIR).filter(
        (name) => name.endsWith(".sql") && name < "0007",
      )) {
        cpSync(join(MIGRATIONS_DIR, file), join(dir, file));
      }

      db = new DatabaseSync(":memory:");
      runMigrations(db, dir);

      cpSync(
        join(MIGRATIONS_DIR, "0007_leads_import_fields.sql"),
        join(dir, "0007_leads_import_fields.sql"),
      );
      const applied = runMigrations(db, dir);

      expect(applied).toEqual(["0007_leads_import_fields"]);
      expect(() =>
        db!.exec("SELECT company, segment, city, imported_at FROM leads"),
      ).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
