import type { LlmResponse, LlmUsage } from "./llm-client.port.ts";

/** `LlmUsage` neutro para testes que não se importam com os contadores. */
export const FAKE_LLM_USAGE: LlmUsage = {
  model: "claude-sonnet-5",
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/**
 * Monta um `LlmResponse` para testes. `usage` parte de `FAKE_LLM_USAGE` e é
 * sobrescrito pelos campos informados.
 */
export function fakeLlmResponse(text: string, usage: Partial<LlmUsage> = {}): LlmResponse {
  return { text, usage: { ...FAKE_LLM_USAGE, ...usage } };
}
