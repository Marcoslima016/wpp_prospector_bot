import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LexicalIndex } from "./lexical-index.ts";
import type { KnowledgeChunk } from "./knowledge.types.ts";
import { buildPinnedContext } from "./pinned-context.ts";
import { parseSalesKnowledge } from "./sales-knowledge.parser.ts";
import { FIELD_SYNONYMS } from "./synonyms.pt-br.ts";

/** Contagem mínima de trechos esperada — abaixo disso, a curadoria está quebrada. */
export const MIN_KNOWLEDGE_CHUNKS = 20;

export const SALES_KNOWLEDGE_FILE = "sales-knowledge.md";
export const PRICING_FILE = "pricing.md";

export interface KnowledgeBundle {
  /** Índice BM25 pronto para consulta (fatia variável). */
  index: LexicalIndex;
  /** Bloco fixo obrigatório (posicionamento + guardrails + planos/preços). */
  pinnedContext: string;
  /** Todos os trechos interpretados. */
  chunks: KnowledgeChunk[];
  /** Conteúdo bruto de `sales-knowledge.md`. */
  salesKnowledgeRaw: string;
  /** Conteúdo bruto de `pricing.md`. */
  pricingRaw: string;
}

/** Erro de preparo da base de conhecimento no boot (fail-fast). */
export class KnowledgeLoadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "KnowledgeLoadError";
  }
}

function readRequired(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (cause) {
    throw new KnowledgeLoadError(
      `Não foi possível ler a base de conhecimento em "${path}": ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { cause },
    );
  }
}

/**
 * Lê `sales-knowledge.md` + `pricing.md` de `dir`, interpreta os trechos,
 * valida os metadados e a contagem mínima, e constrói o índice BM25 e o bloco
 * `pinned`. Lança `KnowledgeLoadError` (ou `KnowledgeParseError`) com mensagem
 * descritiva se algo estiver ausente ou malformado — o caller (boot) deve
 * abortar a inicialização.
 */
export function loadKnowledge(dir: string): KnowledgeBundle {
  const salesKnowledgeRaw = readRequired(join(dir, SALES_KNOWLEDGE_FILE));
  const pricingRaw = readRequired(join(dir, PRICING_FILE));

  if (pricingRaw.trim().length === 0) {
    throw new KnowledgeLoadError(`${PRICING_FILE} está vazio`);
  }

  const chunks = parseSalesKnowledge(salesKnowledgeRaw);

  if (chunks.length < MIN_KNOWLEDGE_CHUNKS) {
    throw new KnowledgeLoadError(
      `${SALES_KNOWLEDGE_FILE}: apenas ${chunks.length} trecho(s) reconhecido(s); esperado ao menos ${MIN_KNOWLEDGE_CHUNKS}`,
    );
  }

  if (!chunks.some((c) => c.pinned)) {
    throw new KnowledgeLoadError(
      `${SALES_KNOWLEDGE_FILE}: nenhum trecho pinned (guardrail/preco/posicionamento) encontrado`,
    );
  }

  if (!chunks.some((c) => !c.pinned)) {
    throw new KnowledgeLoadError(
      `${SALES_KNOWLEDGE_FILE}: nenhum trecho na fatia variável para indexar`,
    );
  }

  const index = LexicalIndex.build(chunks, FIELD_SYNONYMS);
  const pinnedContext = buildPinnedContext(chunks, pricingRaw);

  return { index, pinnedContext, chunks, salesKnowledgeRaw, pricingRaw };
}
