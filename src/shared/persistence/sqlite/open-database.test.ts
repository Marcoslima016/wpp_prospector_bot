import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseOpenError } from "./errors.ts";
import { openDatabase } from "./open-database.ts";

let dir: string;
const open: DatabaseSync[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "open-database-"));
});

afterEach(() => {
  for (const db of open.splice(0)) {
    try {
      db.close();
    } catch {
      // já fechado no teste
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

function openTracked(path: string): DatabaseSync {
  const db = openDatabase(path);
  open.push(db);
  return db;
}

describe("openDatabase", () => {
  it("cria o arquivo num diretório vazio, aplica a migration inicial e o banco fica utilizável", () => {
    const db = openTracked(join(dir, "nested", "app.db"));

    const versions = (
      db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: string }>
    ).map((row) => row.version);
    expect(versions).toContain("0001_init");
  });

  it("é idempotente entre aberturas: reabrir o mesmo arquivo não reaplica migrations", () => {
    const path = join(dir, "app.db");
    const first = openTracked(path);
    const countAfterFirstOpen = (
      first.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number }
    ).n;
    first.close();
    open.splice(0);

    const db = openTracked(path);

    const count = db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number };
    expect(count.n).toBe(countAfterFirstOpen);
  });

  it("mantém foreign_keys em vigor — violação de FK é rejeitada", () => {
    const db = openTracked(join(dir, "app.db"));
    db.exec(
      "CREATE TABLE parent (id INTEGER PRIMARY KEY);" +
        "CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id));",
    );

    expect(() => db.prepare("INSERT INTO child (id, parent_id) VALUES (1, 999)").run()).toThrow();
  });

  it("abre em modo WAL quando o banco é persistido em arquivo", () => {
    const db = openTracked(join(dir, "app.db"));

    const row = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    expect(row.journal_mode.toLowerCase()).toBe("wal");
  });

  it("lança DatabaseOpenError citando o caminho quando o diretório do banco não pode ser preparado", () => {
    const blocker = join(dir, "not-a-dir");
    writeFileSync(blocker, "x");
    const target = join(blocker, "app.db");

    let caught: unknown;
    try {
      openDatabase(target);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DatabaseOpenError);
    expect((caught as Error).message).toContain(target);
  });
});
