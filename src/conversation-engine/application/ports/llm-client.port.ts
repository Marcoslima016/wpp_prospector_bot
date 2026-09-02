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

/** Consumo de tokens reportado pelo provider para uma única chamada. */
export interface LlmUsage {
  /** Modelo efetivamente usado na chamada (pode diferir do alias pedido). */
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Tokens de entrada lidos do cache de prompt. 0 quando não há cache. */
  cacheReadTokens: number;
  /** Tokens de entrada gravados no cache de prompt (cache creation). 0 quando não há cache. */
  cacheWriteTokens: number;
  /** `request-id` da Anthropic, quando o SDK o expõe na resposta. */
  requestId?: string;
}

export interface LlmResponse {
  /** Texto bruto retornado pelo modelo. Quando há `responseSchema`, é o JSON serializado. */
  text: string;
  /** Consumo de tokens desta chamada, para o registro de consumo (best-effort). */
  usage: LlmUsage;
}

/** Abstração fina e agnóstica de provider para geração via LLM. */
export interface LlmClientPort {
  generate(request: LlmRequest): Promise<LlmResponse>;
}
