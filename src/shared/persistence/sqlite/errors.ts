/**
 * Erros de preparo do armazenamento SQL embutido no boot (fail-fast). O caller
 * (boot) deve abortar a inicialização — o processo não sobe.
 */

/** O runtime não disponibiliza `node:sqlite`. */
export class SqliteUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SqliteUnavailableError";
  }
}

/** Falha ao abrir o arquivo de banco (permissão, diretório, disco). */
export class DatabaseOpenError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DatabaseOpenError";
  }
}

/** Falha ao aplicar uma migration. Nenhuma alteração daquela migration persiste. */
export class MigrationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MigrationError";
  }
}
