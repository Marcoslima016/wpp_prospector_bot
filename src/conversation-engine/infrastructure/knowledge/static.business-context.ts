import type { BusinessContextProvider } from "../../application/ports/business-context.port.ts";

export interface StaticBusinessContextConfig {
  /** Conteúdo bruto de `sales-knowledge.md` (KB inteiro). */
  salesKnowledge: string;
  /** Conteúdo bruto de `pricing.md`. */
  pricing: string;
}

/**
 * Adapter alternativo do `BusinessContextProvider`: injeta a base de
 * conhecimento inteira + `pricing.md` no contexto, sem recuperação nem LLM.
 *
 * Serve para testes e experimentos A-B. **Não** é fiado como fallback de
 * runtime — o boot usa `LexicalRetrievalBusinessContext` e faz fail-fast se a
 * base não preparar.
 */
export class StaticBusinessContext implements BusinessContextProvider {
  private readonly content: string;

  constructor(config: StaticBusinessContextConfig) {
    this.content = `${config.salesKnowledge.trim()}\n\n${config.pricing.trim()}`.trim();
  }

  getContext(): Promise<string> {
    return Promise.resolve(this.content);
  }
}
