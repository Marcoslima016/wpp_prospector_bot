import { describe, expect, it } from "vitest";
import { costOf, type MetaConversationPrice, priceFor } from "./meta-conversation-prices.ts";

describe("priceFor", () => {
  it("resolve o preço de uma categoria cadastrada para o país-base", () => {
    const price = priceFor("marketing", "BR", new Date("2026-09-02T00:00:00Z"));

    expect(price?.category).toBe("marketing");
    expect(price?.usdPerConversation).toBeGreaterThan(0);
  });

  it("normaliza a caixa do país", () => {
    expect(priceFor("utility", "br", new Date("2026-09-02T00:00:00Z"))?.category).toBe("utility");
  });

  it("trata service com preço 0 como cadastrado (não indisponível)", () => {
    const price = priceFor("service", "BR", new Date("2026-09-02T00:00:00Z"));

    expect(price).toBeDefined();
    expect(price?.usdPerConversation).toBe(0);
  });

  it("escolhe a entrada de maior effectiveFrom ≤ data", () => {
    const day = new Date("2026-09-02T00:00:00Z");
    const price = priceFor("marketing", "BR", day);
    expect(price?.effectiveFrom).toBe("2025-07-01");

    expect(priceFor("marketing", "BR", new Date("2025-06-30T00:00:00Z"))).toBeUndefined();
  });

  it("categoria 'unknown' → undefined", () => {
    expect(priceFor("unknown", "BR", new Date("2026-09-02T00:00:00Z"))).toBeUndefined();
  });

  it("país sem tabela → undefined (custo indisponível, contagem mantida)", () => {
    expect(priceFor("marketing", "US", new Date("2026-09-02T00:00:00Z"))).toBeUndefined();
  });
});

describe("costOf", () => {
  const price: MetaConversationPrice = {
    category: "marketing",
    country: "BR",
    effectiveFrom: "2025-07-01",
    usdPerConversation: 0.0625,
  };

  it("multiplica a contagem de conversas pelo preço unitário", () => {
    expect(costOf(4, price)).toBeCloseTo(0.25, 6);
  });

  it("é 0 para uma categoria gratuita", () => {
    expect(
      costOf(10, {
        category: "service",
        country: "BR",
        effectiveFrom: "2025-07-01",
        usdPerConversation: 0,
      }),
    ).toBe(0);
  });
});
