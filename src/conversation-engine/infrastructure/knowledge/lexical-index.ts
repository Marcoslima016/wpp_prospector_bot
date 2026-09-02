import type { KnowledgeChunk } from "./knowledge.types.ts";
import { expandWithSynonyms, tokenize } from "./tokenizer.pt-br.ts";

export interface SearchOptions {
  /** Máximo de trechos retornados. */
  topK: number;
  /** Score BM25 mínimo para um trecho entrar no resultado. */
  minScore: number;
}

export interface ScoredChunk {
  chunk: KnowledgeChunk;
  score: number;
}

const BM25_K1 = 1.5;
const BM25_B = 0.75;

interface IndexedDoc {
  chunk: KnowledgeChunk;
  termFreq: Map<string, number>;
  length: number;
}

/**
 * Índice BM25 em memória sobre a **fatia variável** da base (trechos não
 * `pinned`). Reconstruído no boot a partir dos `.md`; não há persistência.
 */
export class LexicalIndex {
  private readonly docs: IndexedDoc[];
  private readonly docFreq: Map<string, number>;
  private readonly avgDocLength: number;
  private readonly synonyms: Record<string, string[]>;

  private constructor(
    docs: IndexedDoc[],
    docFreq: Map<string, number>,
    avgDocLength: number,
    synonyms: Record<string, string[]>,
  ) {
    this.docs = docs;
    this.docFreq = docFreq;
    this.avgDocLength = avgDocLength;
    this.synonyms = synonyms;
  }

  static build(chunks: KnowledgeChunk[], synonyms: Record<string, string[]> = {}): LexicalIndex {
    const variable = chunks.filter((c) => !c.pinned);

    const docs: IndexedDoc[] = variable.map((chunk) => {
      const tokens = tokenize(`${chunk.text} ${chunk.module.replace(/-/g, " ")}`);
      const termFreq = new Map<string, number>();
      for (const token of tokens) {
        termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
      }
      return { chunk, termFreq, length: tokens.length };
    });

    const docFreq = new Map<string, number>();
    for (const doc of docs) {
      for (const term of doc.termFreq.keys()) {
        docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
      }
    }

    const totalLength = docs.reduce((sum, d) => sum + d.length, 0);
    const avgDocLength = docs.length > 0 ? totalLength / docs.length : 0;

    return new LexicalIndex(docs, docFreq, avgDocLength, synonyms);
  }

  /** Trechos da fatia variável (indexados). */
  get variableChunks(): KnowledgeChunk[] {
    return this.docs.map((d) => d.chunk);
  }

  private idf(term: string): number {
    const df = this.docFreq.get(term) ?? 0;
    // BM25 "plus" idf: sempre positivo.
    return Math.log(1 + (this.docs.length - df + 0.5) / (df + 0.5));
  }

  /**
   * Constrói a query (texto do lead + sinais/expansão de sinônimos), pontua os
   * trechos da fatia variável por BM25, descarta os abaixo de `minScore` e
   * devolve os `topK` melhores (dedupe por `id`).
   */
  search(query: string, options: SearchOptions): ScoredChunk[] {
    const expansion = expandWithSynonyms(query, this.synonyms);
    const queryTokens = tokenize(`${query} ${expansion.join(" ")}`);
    if (queryTokens.length === 0 || this.docs.length === 0) return [];

    const uniqueTerms = [...new Set(queryTokens)];

    const scored: ScoredChunk[] = [];
    for (const doc of this.docs) {
      let score = 0;
      for (const term of uniqueTerms) {
        const tf = doc.termFreq.get(term);
        if (!tf) continue;
        const denom =
          tf + BM25_K1 * (1 - BM25_B + (BM25_B * doc.length) / (this.avgDocLength || 1));
        score += this.idf(term) * ((tf * (BM25_K1 + 1)) / denom);
      }
      if (score > 0 && score >= options.minScore) {
        scored.push({ chunk: doc.chunk, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    const seen = new Set<string>();
    const deduped: ScoredChunk[] = [];
    for (const entry of scored) {
      if (seen.has(entry.chunk.id)) continue;
      seen.add(entry.chunk.id);
      deduped.push(entry);
      if (deduped.length >= options.topK) break;
    }

    return deduped;
  }
}
