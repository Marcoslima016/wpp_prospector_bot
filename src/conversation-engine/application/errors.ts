/** Falha identificável na chamada ao provider de LLM (rede, API, timeout, resposta inutilizável). */
export class LlmClientError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "LlmClientError";
  }
}

/** A saída do LLM não aderiu ao formato estruturado exigido pela decisão do bot. */
export class InterpretationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "InterpretationError";
  }
}
