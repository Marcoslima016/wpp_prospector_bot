import { describe, expect, it } from "vitest";
import { costOf, type ModelPrice, priceFor } from "./anthropic-prices.ts";

describe("priceFor", () => {
  it("resolve o preço de um modelo cadastrado", () => {
    const price = priceFor("claude-sonnet-5", new Date("2026-09-10T00:00:00Z"));

    expect(price?.model).toBe("claude-sonnet-5");
    expect(price?.usdPerMTokInput).toBe(3.0);
  });

  it("normaliza o sufixo de data do id do modelo", () => {
    const price = priceFor("claude-haiku-4-5-20251001", new Date("2026-09-10T00:00:00Z"));

    expect(price?.model).toBe("claude-haiku-4-5");
  });

  it("respeita effectiveFrom no limite (inclusivo) da data do evento", () => {
    expect(priceFor("claude-sonnet-5", new Date("2026-08-31T23:59:59Z"))).toBeUndefined();
    expect(priceFor("claude-sonnet-5", new Date("2026-09-01T00:00:00Z"))?.model).toBe(
      "claude-sonnet-5",
    );
  });

  it("retorna undefined para modelo desconhecido", () => {
    expect(priceFor("modelo-inexistente", new Date("2026-09-10T00:00:00Z"))).toBeUndefined();
  });

  it("retorna undefined quando a data do evento é anterior a qualquer preço", () => {
    expect(priceFor("claude-sonnet-5", new Date("2020-01-01T00:00:00Z"))).toBeUndefined();
  });
});

describe("costOf", () => {
  const price: ModelPrice = {
    model: "m",
    effectiveFrom: "2026-01-01",
    usdPerMTokInput: 3.0,
    usdPerMTokOutput: 15.0,
    usdPerMTokCacheRead: 0.3,
    usdPerMTokCacheWrite: 3.75,
  };

  it("soma o custo por tipo de token, em US$", () => {
    const cost = costOf(
      {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
      },
      price,
    );

    expect(cost).toBeCloseTo(3.0 + 15.0 + 0.3 + 3.75, 6);
  });

  it("escala linearmente com a quantidade de tokens", () => {
    const cost = costOf(
      { inputTokens: 500, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      price,
    );

    expect(cost).toBeCloseTo((500 * 3.0) / 1_000_000, 9);
  });
});
