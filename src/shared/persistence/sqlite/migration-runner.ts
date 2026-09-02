import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { MigrationError } from "./errors.ts";

/** Tabela de controle das migrations já aplicadas. */
const SCHEMA_MIGRATIONS_DDL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )
`;

/** `0001_init.sql` -> `0001_init`. */
function versionOf(fileName: string): string {
  return fileName.replace(/\.sql$/, "");
}

function listMigrationFiles(migrationsDir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(migrationsDir);
  } catch (cause) {
    throw new MigrationError(
      `Não foi possível ler o diretório de migrations "${migrationsDir}": ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { cause },
    );
  }
  // Ordem lexical dá a ordem de aplicação (`0001_`, `0002_`, …).
  return entries.filter((name) => name.endsWith(".sql")).sort();
}

/**
 * Aplica, em ordem lexical, as migrations de `migrationsDir` ainda não
 * registradas em `schema_migrations`. Cada migration roda numa transação junto
 * com o registro da sua versão — se falhar, nada dela persiste e o erro é
 * propagado com a `version`. Idempotente: sem migrations pendentes, não faz nada.
 *
 * @returns as versões aplicadas neste chamada (vazio se já estava em dia).
 */
export function runMigrations(db: DatabaseSync, migrationsDir: string): string[] {
  db.exec(SCHEMA_MIGRATIONS_DDL);

  const alreadyApplied = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: string }>).map(
      (row) => row.version,
    ),
  );

  const applied: string[] = [];

  for (const fileName of listMigrationFiles(migrationsDir)) {
    const version = versionOf(fileName);
    if (alreadyApplied.has(version)) continue;

    const sql = readFileSync(join(migrationsDir, fileName), "utf8");

    try {
      db.exec("BEGIN");
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        version,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (cause) {
      db.exec("ROLLBACK");
      throw new MigrationError(
        `Falha ao aplicar a migration "${version}": ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        { cause },
      );
    }

    applied.push(version);
  }

  return applied;
}
