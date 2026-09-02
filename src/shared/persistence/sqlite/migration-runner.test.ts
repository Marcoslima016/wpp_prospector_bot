import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MigrationError } from "./errors.ts";
import { runMigrations } from "./migration-runner.ts";

let dir: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "migration-runner-"));
  db = new DatabaseSync(":memory:");
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function writeMigration(name: string, sql: string): void {
  writeFileSync(join(dir, name), sql, "utf8");
}

function appliedVersions(): string[] {
  return (
    db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{
      version: string;
    }>
  ).map((row) => row.version);
}

describe("runMigrations", () => {
  it("aplica as migrations pendentes em ordem lexical e registra as versões", () => {
    writeMigration("0002_add_b.sql", "CREATE TABLE b (id INTEGER PRIMARY KEY);");
    writeMigration("0001_init.sql", "CREATE TABLE a (id INTEGER PRIMARY KEY);");

    const applied = runMigrations(db, dir);

    expect(applied).toEqual(["0001_init", "0002_add_b"]);
    expect(appliedVersions()).toEqual(["0001_init", "0002_add_b"]);
    expect(() => db.exec("SELECT 1 FROM a")).not.toThrow();
    expect(() => db.exec("SELECT 1 FROM b")).not.toThrow();
  });

  it("é idempotente: rodar de novo sem pendências não reaplica nem duplica o controle", () => {
    writeMigration("0001_init.sql", "CREATE TABLE a (id INTEGER PRIMARY KEY);");
    runMigrations(db, dir);

    const applied = runMigrations(db, dir);

    expect(applied).toEqual([]);
    const count = db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number };
    expect(count.n).toBe(1);
  });

  it("aplica apenas a migration nova quando o diretório ganha um arquivo entre execuções", () => {
    writeMigration("0001_init.sql", "CREATE TABLE a (id INTEGER PRIMARY KEY);");
    runMigrations(db, dir);

    writeMigration("0002_add_b.sql", "CREATE TABLE b (id INTEGER PRIMARY KEY);");
    const applied = runMigrations(db, dir);

    expect(applied).toEqual(["0002_add_b"]);
    expect(appliedVersions()).toEqual(["0001_init", "0002_add_b"]);
  });

  it("lança MigrationError com a versão que falhou e não deixa rastro dessa migration", () => {
    writeMigration("0001_ok.sql", "CREATE TABLE a (id INTEGER PRIMARY KEY);");
    writeMigration(
      "0002_bad.sql",
      "CREATE TABLE b (id INTEGER PRIMARY KEY);\nESTA LINHA NAO E SQL VALIDO;",
    );

    let caught: unknown;
    try {
      runMigrations(db, dir);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MigrationError);
    expect((caught as Error).message).toContain("0002_bad");
    // 0001 entrou na sua própria transação; 0002 sofreu rollback por inteiro.
    expect(appliedVersions()).toEqual(["0001_ok"]);
    expect(() => db.exec("SELECT 1 FROM b")).toThrow();
  });

  it("ignora arquivos que não terminam em .sql", () => {
    writeMigration("0001_init.sql", "CREATE TABLE a (id INTEGER PRIMARY KEY);");
    writeMigration("notes.md", "isto não é uma migration");

    expect(runMigrations(db, dir)).toEqual(["0001_init"]);
  });

  it("propaga MigrationError quando o diretório de migrations não existe", () => {
    expect(() => runMigrations(db, join(dir, "inexistente"))).toThrow(MigrationError);
  });
});
