import { describe, expect, it } from "vitest";
import { WhatsappConversationBilling } from "./whatsapp-conversation-billing.ts";

describe("WhatsappConversationBilling.fromWebhook", () => {
  it("mapeia pricing + conversation completos", () => {
    const billing = WhatsappConversationBilling.fromWebhook(
      { billable: true, pricing_model: "CBP", category: "marketing" },
      { id: "conv-1", origin: { type: "marketing" }, expiration_timestamp: "1700086400" },
    );

    expect(billing).not.toBeNull();
    expect(billing).toMatchObject({
      conversationId: "conv-1",
      category: "marketing",
      originType: "marketing",
      pricingModel: "CBP",
      billable: true,
    });
    expect(billing!.expirationTimestamp).toEqual(new Date(1700086400 * 1000));
  });

  it("retorna null quando não há conversation.id", () => {
    expect(WhatsappConversationBilling.fromWebhook({ category: "utility" }, undefined)).toBeNull();
    expect(
      WhatsappConversationBilling.fromWebhook({ category: "utility" }, { id: "  " }),
    ).toBeNull();
  });

  it("categoria desconhecida ou ausente vira 'unknown'", () => {
    expect(
      WhatsappConversationBilling.fromWebhook({ category: "categoria_nova" }, { id: "c" })!.category,
    ).toBe("unknown");
    expect(WhatsappConversationBilling.fromWebhook(undefined, { id: "c" })!.category).toBe("unknown");
  });

  it("normaliza a caixa da categoria", () => {
    expect(
      WhatsappConversationBilling.fromWebhook({ category: "AUTHENTICATION" }, { id: "c" })!.category,
    ).toBe("authentication");
  });

  it("aplica defaults tolerantes quando pricing/origin vêm vazios", () => {
    const billing = WhatsappConversationBilling.fromWebhook({}, { id: "conv-2" })!;

    expect(billing).toMatchObject({
      conversationId: "conv-2",
      category: "unknown",
      originType: "",
      pricingModel: "",
      billable: false,
    });
    expect(billing.expirationTimestamp).toBeUndefined();
  });

  it("billable só é true quando a Meta marca explicitamente", () => {
    expect(WhatsappConversationBilling.fromWebhook({ billable: false }, { id: "c" })!.billable).toBe(
      false,
    );
    expect(WhatsappConversationBilling.fromWebhook({}, { id: "c" })!.billable).toBe(false);
  });

  it("expiration_timestamp inválido vira undefined", () => {
    expect(
      WhatsappConversationBilling.fromWebhook({}, { id: "c", expiration_timestamp: "abc" })!
        .expirationTimestamp,
    ).toBeUndefined();
  });
});
