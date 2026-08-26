import { z } from "zod";

const webhookMessageSchema = z.object({
  from: z.string(),
  id: z.string(),
  timestamp: z.string(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
});

const webhookStatusSchema = z.object({
  id: z.string(),
  status: z.enum(["sent", "delivered", "read", "failed"]),
  timestamp: z.string(),
  recipient_id: z.string(),
});

const webhookChangeValueSchema = z.object({
  messaging_product: z.literal("whatsapp"),
  messages: z.array(webhookMessageSchema).optional(),
  statuses: z.array(webhookStatusSchema).optional(),
});

const webhookChangeSchema = z.object({
  value: webhookChangeValueSchema,
  field: z.string(),
});

const webhookEntrySchema = z.object({
  id: z.string(),
  changes: z.array(webhookChangeSchema),
});

export const webhookPayloadSchema = z.object({
  object: z.string(),
  entry: z.array(webhookEntrySchema),
});

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;
export type WebhookMessage = z.infer<typeof webhookMessageSchema>;
export type WebhookStatus = z.infer<typeof webhookStatusSchema>;

export type WebhookEvent =
  | { type: "message"; message: WebhookMessage }
  | { type: "status"; status: WebhookStatus }
  | { type: "unknown" };

/**
 * Discrimina cada `changes[].value` entre mensagem recebida (`messages[]`) e
 * atualização de status (`statuses[]`); tipos de evento ainda não suportados
 * viram `{ type: "unknown" }` em vez de derrubar o parsing.
 */
export function extractWebhookEvents(payload: WebhookPayload): WebhookEvent[] {
  const events: WebhookEvent[] = [];

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const { messages, statuses } = change.value;
      let recognized = false;

      for (const message of messages ?? []) {
        events.push({ type: "message", message });
        recognized = true;
      }

      for (const status of statuses ?? []) {
        events.push({ type: "status", status });
        recognized = true;
      }

      if (!recognized) {
        events.push({ type: "unknown" });
      }
    }
  }

  return events;
}
