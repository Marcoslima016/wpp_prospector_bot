import type {
  BusinessContextInput,
  BusinessContextProvider,
} from "../../application/ports/business-context.port.ts";
import type { LlmClientPort } from "../../application/ports/llm-client.port.ts";
import type { Logger } from "../../application/ports/logger.port.ts";
import { RETRIEVED_CONTEXT_SEPARATOR } from "../../domain/reply-strategy.ts";
import type { LexicalIndex } from "./lexical-index.ts";
import {
  EXTRACTION_JSON_SCHEMA,
  EXTRACTION_SYSTEM_PROMPT,
  isEmptySignals,
  localExtraction,
  parseExtractionSignals,
  signalsToQuery,
  type ExtractionSignals,
} from "./signal-extraction.ts";
import { FIELD_SYNONYMS } from "./synonyms.pt-br.ts";

export interface LexicalRetrievalConfig {
  llmClient: LlmClientPort;
  index: LexicalIndex;
  /** Conjunto fixo obrigatório (posicionamento + guardrails + planos/preços). */
  pinnedContext: string;
  /** Modelo da chamada #1 (extração de sinais). */
  extractionModel: string;
  topK: number;
  minScore: number;
  logger?: Logger;
  /** Mapa de sinônimos para a extração local (fallback). Default: `FIELD_SYNONYMS`. */
  synonyms?: Record<string, string[]>;
  /** Teto de tokens da resposta de extração. */
  extractionMaxTokens?: number;
}

/**
 * Adapter de produção do `BusinessContextProvider` — RAG léxico local, 2 chamadas:
 *
 * 1. chamada #1 (LLM) extrai sinais de busca (`temas`, `dores`,
 *    `modulosProvaveis`) das mensagens do lead. Falha ou vazio → extração local
 *    determinística (normalização + sinônimos). O turno nunca falha por causa disso.
 * 2. busca BM25 na fatia variável da base → top-k trechos.
 *
 * Retorno: `pinnedContext` + (se houver trechos) `RETRIEVED_CONTEXT_SEPARATOR` +
 * trechos recuperados. O `pinnedContext` está SEMPRE presente.
 */
export class LexicalRetrievalBusinessContext implements BusinessContextProvider {
  private readonly llmClient: LlmClientPort;
  private readonly index: LexicalIndex;
  private readonly pinnedContext: string;
  private readonly extractionModel: string;
  private readonly topK: number;
  private readonly minScore: number;
  private readonly logger?: Logger;
  private readonly synonyms: Record<string, string[]>;
  private readonly extractionMaxTokens: number;

  constructor(config: LexicalRetrievalConfig) {
    this.llmClient = config.llmClient;
    this.index = config.index;
    this.pinnedContext = config.pinnedContext.trim();
    this.extractionModel = config.extractionModel;
    this.topK = config.topK;
    this.minScore = config.minScore;
    this.logger = config.logger;
    this.synonyms = config.synonyms ?? FIELD_SYNONYMS;
    this.extractionMaxTokens = config.extractionMaxTokens ?? 400;
  }

  async getContext(input: BusinessContextInput): Promise<string> {
    const { newMessages } = input;

    const signals = await this.extractSignals(newMessages);
    const query = signalsToQuery(signals, newMessages);

    const results = query.trim()
      ? this.index.search(query, { topK: this.topK, minScore: this.minScore })
      : [];

    if (results.length === 0) {
      return this.pinnedContext;
    }

    const retrieved = results.map((r) => r.chunk.text.trim()).join("\n\n");
    return `${this.pinnedContext}${RETRIEVED_CONTEXT_SEPARATOR}${retrieved}`;
  }

  /** Chamada #1 com fallback local. Nunca lança. */
  private async extractSignals(newMessages: string[]): Promise<ExtractionSignals> {
    try {
      const response = await this.llmClient.generate({
        system: EXTRACTION_SYSTEM_PROMPT,
        messages: newMessages.map((content) => ({ role: "user" as const, content })),
        model: this.extractionModel,
        maxTokens: this.extractionMaxTokens,
        responseSchema: EXTRACTION_JSON_SCHEMA as unknown as Record<string, unknown>,
      });

      const parsed = parseExtractionSignals(response.text);
      if (parsed && !isEmptySignals(parsed)) {
        return parsed;
      }
      this.logger?.info("Extração de sinais vazia/inválida — usando extração local");
    } catch (error) {
      this.logger?.warn("Falha na chamada de extração de sinais — usando extração local", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return localExtraction(newMessages, this.synonyms);
  }
}
