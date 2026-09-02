import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { DatabaseOpenError, SqliteUnavailableError } from "./errors.ts";
import { runMigrations } from "./migration-runner.ts";

const IN_MEMORY = ":memory:";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

/**
 * `journal_mode = WAL`  — leitura concorrente com a escrita (a API de gestão lê
 *   enquanto o webhook escreve). Ignorado silenciosamente em `:memory:`.
 * `foreign_keys = ON`   — integridade referencial em vigor.
 * `busy_timeout = 5000` — espera em vez de falhar de imediato sob contenção.
 * `synchronous = NORMAL`— seguro com WAL e mais rápido.
 */
const PRAGMAS = [
  "PRAGMA journal_mode = WAL",
  "PRAGMA foreign_keys = ON",
  "PRAGMA busy_timeout = 5000",
  "PRAGMA synchronous = NORMAL",
] as const;

function loadSqlite(): typeof import("node:sqlite") {
  const mod = process.getBuiltinModule("node:sqlite");
  if (!mod) {
    throw new SqliteUnavailableError(
      "O runtime não disponibiliza `node:sqlite`. Use Node 24.x (ou 22.13+/23.4+); " +
        "em versões anteriores era necessária a flag `--experimental-sqlite`.",
    );
  }
  return mod;
}

/**
 * Abre o armazenamento SQL embutido em `path`, aplica os PRAGMAs de
 * confiabilidade, roda as migrations pendentes e devolve a conexão pronta para
 * injeção. Processo único — uma conexão para todo o processo, sem pool; os
 * adapters recebem esta conexão, não a abrem.
 *
 * Fail-fast: lança `SqliteUnavailableError`, `DatabaseOpenError` ou
 * `MigrationError` (todas com mensagem acionável) se qualquer etapa falhar — o
 * boot deve abortar e o processo não sobe.
 *
 * `path` pode ser `":memory:"` para um banco efêmero (usado em teste).
 */
export function openDatabase(path: string): DatabaseSync {
  const { DatabaseSync } = loadSqlite();

  if (path !== IN_MEMORY) {
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch (cause) {
      throw new DatabaseOpenError(
        `Não foi possível preparar o diretório do banco para "${path}": ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        { cause },
      );
    }
  }

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path);
  } catch (cause) {
    throw new DatabaseOpenError(
      `Não foi possível abrir o banco SQLite em "${path}": ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { cause },
    );
  }

  for (const pragma of PRAGMAS) {
    db.exec(pragma);
  }

  const applied = runMigrations(db, MIGRATIONS_DIR);
  if (applied.length > 0) {
    console.info(`SQLite (${path}): migration(s) aplicada(s) — ${applied.join(", ")}`);
  }

  return db;
}
