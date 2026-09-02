export type LlmMessageRole = "user" | "assistant";

export interface LlmMessage {
  role: LlmMessageRole;
  content: string;
}

/**
 * Bloco do system prompt. `cacheable: true` marca o fim de um prefixo estável
 * que o provider pode manter em cache (prompt caching). Só o último bloco
 * cacheável precisa da marca — o cache é por prefixo.
 */
export interface LlmSystemBlock {
  text: string;
  cacheable?: boolean;
}

export interface LlmRequest {
  /**
   * System prompt. String simples ou lista de blocos — a forma em blocos
   * permite marcar o prefixo cacheável (persona + conteúdo fixo) separado do
   * conteúdo variável recuperado.
   */
  system: string | LlmSystemBlock[];
  messages: LlmMessage[];
  model: string;
  maxTokens: number;
  /** JSON Schema para forçar saída estruturada. Quando ausente, a saída é texto livre. */
  responseSchema?: Record<string, unknown>;
}

export interface LlmResponse {
  /** Texto bruto retornado pelo modelo. Quando há `responseSchema`, é o JSON serializado. */
  text: string;
}

/** Abstração fina e agnóstica de provider para geração via LLM. */
export interface LlmClientPort {
  generate(request: LlmRequest): Promise<LlmResponse>;
}
