import type { LlmUsage } from "../../application/ports/llm-client.port.ts";

/**
 * Versão da tabela de preços — gravada em cada evento de consumo
 * (`llm_usage_events.price_version`) para rastreio/desempate. Faça bump ao
 * alterar `ANTHROPIC_PRICES`.
 */
export const PRICE_TABLE_VERSION = "2026-09-01";

/** Preço de um modelo, em US$ por milhão de tokens, por tipo de token. */
export interface ModelPrice {
  model: string;
  /** Data (YYYY-MM-DD) a partir da qual este preço vale. */
  effectiveFrom: string;
  usdPerMTokInput: number;
  usdPerMTokOutput: number;
  usdPerMTokCacheRead: number;
  usdPerMTokCacheWrite: number;
}

/**
 * Preços first-party da Anthropic (US$/MTok). `cacheRead` = 0.1× input,
 * `cacheWrite` = 1.25× input (breakpoint efêmero de 5 min, o usado nesta base).
 * Fonte: https://www.anthropic.com/pricing — revisar ao mudar de modelo ou de
 * tabela de preços e fazer bump de `PRICE_TABLE_VERSION`.
 */
export const ANTHROPIC_PRICES: readonly ModelPrice[] = [
  {
    model: "claude-sonnet-5",
    effectiveFrom: "2026-09-01",
    usdPerMTokInput: 3.0,
    usdPerMTokOutput: 15.0,
    usdPerMTokCacheRead: 0.3,
    usdPerMTokCacheWrite: 3.75,
  },
  {
    model: "claude-haiku-4-5",
    effectiveFrom: "2026-09-01",
    usdPerMTokInput: 1.0,
    usdPerMTokOutput: 5.0,
    usdPerMTokCacheRead: 0.1,
    usdPerMTokCacheWrite: 1.25,
  },
  {
    model: "claude-opus-5",
    effectiveFrom: "2026-09-01",
    usdPerMTokInput: 5.0,
    usdPerMTokOutput: 25.0,
    usdPerMTokCacheRead: 0.5,
    usdPerMTokCacheWrite: 6.25,
  },
];

/** `claude-haiku-4-5-20251001` → `claude-haiku-4-5`. Deixa o alias intacto. */
function normalizeModel(model: string): string {
  return model.replace(/-\d{8}$/, "");
}

/**
 * Preço vigente de `model` na data `onDate`: a entrada de maior `effectiveFrom`
 * que não passa de `onDate`. `undefined` quando o modelo não está cadastrado —
 * nesse caso o custo é indisponível (mas os tokens continuam agregáveis).
 */
export function priceFor(model: string, onDate: Date): ModelPrice | undefined {
  const wanted = normalizeModel(model);
  const day = onDate.toISOString().slice(0, 10);

  return ANTHROPIC_PRICES.filter(
    (price) => normalizeModel(price.model) === wanted && price.effectiveFrom <= day,
  ).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
}

/** Contadores de token agregados de um ou mais eventos de consumo. */
export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Custo em US$ dos `tokens` segundo `price`. */
export function costOf(tokens: TokenCounts, price: ModelPrice): number {
  return (
    (tokens.inputTokens * price.usdPerMTokInput +
      tokens.outputTokens * price.usdPerMTokOutput +
      tokens.cacheReadTokens * price.usdPerMTokCacheRead +
      tokens.cacheWriteTokens * price.usdPerMTokCacheWrite) /
    1_000_000
  );
}

/** Extrai os contadores de token de um `LlmUsage`. */
export function tokenCountsOf(usage: LlmUsage): TokenCounts {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
  };
}
