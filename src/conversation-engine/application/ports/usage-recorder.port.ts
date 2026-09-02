import type { LlmUsage } from "./llm-client.port.ts";

/** Qual das chamadas ao LLM do fluxo de interpretação originou o consumo. */
export type LlmCallType = "reply-generation" | "signal-extraction";

export interface LlmUsageEvent {
  /** Instante da chamada ao LLM. */
  occurredAt: Date;
  callType: LlmCallType;
  /** Telefone do lead quando a chamada está associada a uma conversa. */
  leadPhone?: string;
  usage: LlmUsage;
}

/**
 * Registra o consumo de uma chamada ao LLM (série temporal append-only). O
 * registro é best-effort: `recordLlmCall` NÃO deve rejeitar nem lançar — uma
 * falha de gravação é engolida e logada pelo adapter.
 */
export interface UsageRecorderPort {
  recordLlmCall(event: LlmUsageEvent): Promise<void>;
}
