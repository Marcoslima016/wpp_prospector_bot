import { z } from "zod";
import { isoDateStringSchema, prospectingStateSchema } from "./common.ts";

/**
 * Um lead de prospecção como exposto pela API de gestão. `firstContactAt` e
 * `repliedAt` são `null` enquanto as transições correspondentes não ocorreram.
 * `company` / `segment` / `city` vêm do contexto de importação (`null` quando ausentes).
 */
export const leadResourceSchema = z.object({
  phone: z.string(),
  displayName: z.string().nullable(),
  source: z.string().nullable(),
  notes: z.string().nullable(),
  company: z.string().nullable(),
  segment: z.string().nullable(),
  city: z.string().nullable(),
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

/** Item da listagem paginada de leads — mesmo shape do recurso de lead. */
export const leadListItemSchema = leadResourceSchema;
export type LeadListItem = z.infer<typeof leadListItemSchema>;

/** Página de `GET /admin/api/leads`: itens + tamanho da página + cursor da próxima. */
export const leadListPageSchema = z.object({
  items: z.array(leadListItemSchema),
  pageSize: z.number().int().positive(),
  nextCursor: z.string().nullable(),
});
export type LeadListPage = z.infer<typeof leadListPageSchema>;

/** Um item do lote de `POST /admin/api/leads/import` (já extraído/normalizado pelo cliente). */
export const importLeadItemSchema = z.object({
  phone: z.string(),
  displayName: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
  notes: z.string().min(1).optional(),
  company: z.string().min(1).optional(),
  segment: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
});
export type ImportLeadItem = z.infer<typeof importLeadItemSchema>;

/** Corpo de `POST /admin/api/leads/import`. */
export const importLeadsInputSchema = z.object({
  leads: z.array(importLeadItemSchema),
});
export type ImportLeadsInput = z.infer<typeof importLeadsInputSchema>;

/** Uma linha rejeitada na importação, com a linha de origem e o motivo. */
export const importRejectedItemSchema = z.object({
  row: z.number().int().nonnegative(),
  phone: z.string(),
  reason: z.string(),
});
export type ImportRejectedItem = z.infer<typeof importRejectedItemSchema>;

/** Resultado de `POST /admin/api/leads/import`. */
export const importLeadsResultSchema = z.object({
  imported: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  rejected: z.array(importRejectedItemSchema),
});
export type ImportLeadsResult = z.infer<typeof importLeadsResultSchema>;

/** Corpo de `POST /admin/api/leads/prospect`. */
export const bulkProspectInputSchema = z.object({
  phones: z.array(z.string()),
  force: z.boolean().optional(),
});
export type BulkProspectInput = z.infer<typeof bulkProspectInputSchema>;

/** Desfecho do disparo em lote para um telefone. */
export const bulkProspectOutcomeSchema = z.enum(["sent", "skipped", "failed"]);
export type BulkProspectOutcome = z.infer<typeof bulkProspectOutcomeSchema>;

/** Um resultado por telefone do disparo em lote. */
export const bulkProspectResultItemSchema = z.object({
  phone: z.string(),
  outcome: bulkProspectOutcomeSchema,
  wamid: z.string().nullable().optional(),
  reason: z.string().optional(),
  /** O lead após o disparo; `null` quando não há lead cadastrado para o telefone. */
  lead: leadResourceSchema.nullable(),
});
export type BulkProspectResultItem = z.infer<typeof bulkProspectResultItemSchema>;

/** Resultado de `POST /admin/api/leads/prospect` — um resultado por telefone. */
export const bulkProspectResultSchema = z.object({
  results: z.array(bulkProspectResultItemSchema),
});
export type BulkProspectResult = z.infer<typeof bulkProspectResultSchema>;

/** Resultado de `POST /admin/api/leads/:leadPhone/reset` — o lead atualizado. */
export const resetLeadResultSchema = leadResourceSchema;
export type ResetLeadResult = z.infer<typeof resetLeadResultSchema>;
