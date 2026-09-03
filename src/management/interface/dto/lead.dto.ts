import { z } from "zod";
import { isoDateStringSchema, prospectingStateSchema } from "./common.ts";

/**
 * Um lead de prospecção como exposto pela API de gestão. `firstContactAt` e
 * `repliedAt` são `null` enquanto as transições correspondentes não ocorreram.
 */
export const leadResourceSchema = z.object({
  phone: z.string(),
  displayName: z.string().nullable(),
  source: z.string().nullable(),
  notes: z.string().nullable(),
  prospectingState: prospectingStateSchema,
  firstContactAt: isoDateStringSchema.nullable(),
  repliedAt: isoDateStringSchema.nullable(),
});

export type LeadResource = z.infer<typeof leadResourceSchema>;

/** Resultado de `POST /admin/api/leads` — o lead cadastrado/atualizado. */
export const registerLeadResultSchema = leadResourceSchema;
export type RegisterLeadResult = z.infer<typeof registerLeadResultSchema>;

/**
 * Resultado de `POST /admin/api/leads/:leadPhone/prospect` — o `wamid` do
 * template enviado (`null` quando o disparo foi ignorado por idempotência),
 * se já havia sido prospectado, e o estado atualizado do lead.
 */
export const prospectLeadResultSchema = z.object({
  wamid: z.string().nullable(),
  alreadyProspected: z.boolean(),
  lead: leadResourceSchema,
});
export type ProspectLeadResult = z.infer<typeof prospectLeadResultSchema>;
