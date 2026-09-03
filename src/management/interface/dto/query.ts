import { z } from "zod";
import {
  conversationStateSchema,
  isoDateStringSchema,
  leadIntentSchema,
  prospectingStateSchema,
} from "./common.ts";
import { consumptionGroupBySchema } from "./consumption.dto.ts";

/** Teto de itens por página da listagem de conversas. */
export const CONVERSATIONS_PAGE_MAX = 100;
export const CONVERSATIONS_PAGE_DEFAULT = 25;

/** Query de `GET /admin/api/conversations`. Valores chegam como string (querystring). */
export const conversationListQuerySchema = z.object({
  state: conversationStateSchema.optional(),
  leadIntent: leadIntentSchema.optional(),
  /** Trecho do telefone do lead (match parcial). */
  phone: z.string().trim().min(1).optional(),
  /** Faixa de data de última atividade, inclusiva no início / exclusiva no fim. */
  activityFrom: isoDateStringSchema.optional(),
  activityTo: isoDateStringSchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(CONVERSATIONS_PAGE_MAX)
    .default(CONVERSATIONS_PAGE_DEFAULT),
  /** Cursor opaco devolvido em `nextCursor` da página anterior. */
  cursor: z.string().min(1).optional(),
});

export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;

/** Teto de itens por página da listagem de leads. */
export const LEADS_PAGE_MAX = 100;
export const LEADS_PAGE_DEFAULT = 25;

/** Query de `GET /admin/api/leads`. Valores chegam como string (querystring). */
export const leadListQuerySchema = z.object({
  state: prospectingStateSchema.optional(),
  /** Trecho do telefone do lead (match parcial). */
  phone: z.string().trim().min(1).optional(),
  segment: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().positive().max(LEADS_PAGE_MAX).default(LEADS_PAGE_DEFAULT),
  /** Cursor opaco devolvido em `nextCursor` da página anterior. */
  cursor: z.string().min(1).optional(),
});

export type LeadListQuery = z.infer<typeof leadListQuerySchema>;

/** Query de `GET /admin/api/stats/consumption`. */
export const consumptionQuerySchema = z.object({
  from: isoDateStringSchema,
  to: isoDateStringSchema,
  groupBy: consumptionGroupBySchema.default("day"),
});

export type ConsumptionQuery = z.infer<typeof consumptionQuerySchema>;
