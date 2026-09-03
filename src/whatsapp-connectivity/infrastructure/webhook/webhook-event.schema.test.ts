import { describe, expect, it } from "vitest";
import { extractWebhookEvents, webhookPayloadSchema } from "./webhook-event.schema.ts";

function buildPayload(value: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-id",
        changes: [{ value: { messaging_product: "whatsapp", ...value }, field: "messages" }],
      },
    ],
  };
}

describe("webhookPayloadSchema + extractWebhookEvents", () => {
  it("discrimina um evento de mensagem de texto recebida", () => {
    const payload = buildPayload({
      messages: [
        {
          from: "5511999999999",
          id: "wamid.1",
          timestamp: "1700000000",
          type: "text",
          text: { body: "oi" },
        },
      ],
    });

    const parsed = webhookPayloadSchema.parse(payload);
    const events = extractWebhookEvents(parsed);

    expect(events).toEqual([
      {
        type: "message",
        message: {
          from: "5511999999999",
          id: "wamid.1",
          timestamp: "1700000000",
          type: "text",
          text: { body: "oi" },
        },
      },
    ]);
  });

  it("discrimina um evento de atualização de status, distinguindo-o de mensagem recebida", () => {
    const payload = buildPayload({
      statuses: [
        {
          id: "wamid.1",
          status: "delivered",
          timestamp: "1700000000",
          recipient_id: "5511999999999",
        },
      ],
    });

    const parsed = webhookPayloadSchema.parse(payload);
    const events = extractWebhookEvents(parsed);

    expect(events).toEqual([
      {
        type: "status",
        status: {
          id: "wamid.1",
          status: "delivered",
          timestamp: "1700000000",
          recipient_id: "5511999999999",
        },
      },
    ]);
  });

  it("parseia um evento de status com pricing e conversation completos", () => {
    const payload = buildPayload({
      statuses: [
        {
          id: "wamid.1",
          status: "sent",
          timestamp: "1700000000",
          recipient_id: "5511999999999",
          pricing: { billable: true, pricing_model: "CBP", category: "marketing" },
          conversation: {
            id: "conv-1",
            origin: { type: "marketing" },
            expiration_timestamp: "1700086400",
          },
        },
      ],
    });

    const parsed = webhookPayloadSchema.parse(payload);
    const [event] = extractWebhookEvents(parsed);

    expect(event).toMatchObject({
      type: "status",
      status: {
        pricing: { billable: true, pricing_model: "CBP", category: "marketing" },
        conversation: {
          id: "conv-1",
          origin: { type: "marketing" },
          expiration_timestamp: "1700086400",
        },
      },
    });
  });

  it("mantém válido um evento de status sem pricing/conversation", () => {
    const payload = buildPayload({
      statuses: [
        { id: "wamid.1", status: "read", timestamp: "1700000000", recipient_id: "5511999999999" },
      ],
    });

    const parsed = webhookPayloadSchema.parse(payload);
    const [event] = extractWebhookEvents(parsed);

    expect(event).toEqual({
      type: "status",
      status: {
        id: "wamid.1",
        status: "read",
        timestamp: "1700000000",
        recipient_id: "5511999999999",
      },
    });
  });

  it("não derruba o parsing com campos desconhecidos dentro de pricing/conversation", () => {
    const payload = buildPayload({
      statuses: [
        {
          id: "wamid.1",
          status: "sent",
          timestamp: "1700000000",
          recipient_id: "5511999999999",
          pricing: { billable: true, category: "categoria_nova_da_meta", foo: "bar" },
          conversation: { id: "conv-1", origin: { type: "novo_tipo", extra: 1 }, baz: true },
        },
      ],
    });

    expect(() => webhookPayloadSchema.parse(payload)).not.toThrow();
    const [event] = extractWebhookEvents(webhookPayloadSchema.parse(payload));
    expect(event).toMatchObject({
      type: "status",
      status: { pricing: { category: "categoria_nova_da_meta" }, conversation: { id: "conv-1" } },
    });
  });

  it("marca eventos sem messages[] nem statuses[] como não suportados, sem falhar o parsing", () => {
    const payload = buildPayload({});

    const parsed = webhookPayloadSchema.parse(payload);
    const events = extractWebhookEvents(parsed);

    expect(events).toEqual([{ type: "unknown" }]);
  });
});
