export type LlmMessageRole = "user" | "assistant";

export interface LlmMessage {
  role: LlmMessageRole;
  content: string;
}

export interface LlmRequest {
  system: string;
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
