import { z } from "zod";

const webhookMessageSchema = z.object({
  from: z.string(),
  id: z.string(),
  timestamp: z.string(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  button: z.object({ text: z.string(), payload: z.string().optional() }).optional(),
});

const webhookStatusErrorSchema = z.object({
  code: z.number().optional(),
  title: z.string().optional(),
  message: z.string().optional(),
});

// A Meta cobra por janela de conversa de 24 h, não por mensagem. Esses dados de
// precificação/conversa chegam em alguns eventos de status (tipicamente o
// primeiro status faturável da janela). `category`/`pricing_model` ficam como
// `string` (não `enum`) e `looseObject` preserva campos novos — um valor
// desconhecido da Meta NÃO deve derrubar o parsing do evento inteiro.
const webhookStatusPricingSchema = z.looseObject({
  billable: z.boolean().optional(),
  pricing_model: z.string().optional(),
  category: z.string().optional(),
});

const webhookStatusConversationSchema = z.looseObject({
  id: z.string().optional(),
  origin: z.looseObject({ type: z.string().optional() }).optional(),
  expiration_timestamp: z.string().optional(),
});

const webhookStatusSchema = z.object({
  id: z.string(),
  status: z.enum(["sent", "delivered", "read", "failed"]),
  timestamp: z.string(),
  recipient_id: z.string(),
  errors: z.array(webhookStatusErrorSchema).optional(),
  pricing: webhookStatusPricingSchema.optional(),
  conversation: webhookStatusConversationSchema.optional(),
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
