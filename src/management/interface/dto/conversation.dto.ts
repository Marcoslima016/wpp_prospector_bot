import { z } from "zod";
import {
  commercialPlanSchema,
  conversationStateSchema,
  isoDateStringSchema,
  leadIntentSchema,
  leadQualificationSchema,
  moduleIdSchema,
  outboundTurnKindSchema,
  outboundTurnOriginSchema,
} from "./common.ts";

/** Item da listagem paginada — projeção de leitura, sem o histórico de turnos. */
export const conversationListItemSchema = z.object({
  leadPhone: z.string(),
  state: conversationStateSchema,
  leadIntent: leadIntentSchema,
  leadQualification: leadQualificationSchema.nullable(),
  turnCount: z.number().int().nonnegative(),
  /** `null` só no caso raro de conversa persistida sem nenhum turno. */
  lastActivityAt: isoDateStringSchema.nullable(),
  hasPendingInbound: z.boolean(),
  quotedPlan: commercialPlanSchema.nullable(),
});

export type ConversationListItem = z.infer<typeof conversationListItemSchema>;

/** Página da listagem: itens + tamanho da página + cursor da próxima página. */
export const conversationListPageSchema = z.object({
  items: z.array(conversationListItemSchema),
  pageSize: z.number().int().positive(),
  nextCursor: z.string().nullable(),
});

export type ConversationListPage = z.infer<typeof conversationListPageSchema>;

/** Turno inbound no detalhe da conversa. */
export const conversationDetailInboundTurnSchema = z.object({
  direction: z.literal("inbound"),
  text: z.string(),
  timestamp: isoDateStringSchema,
  messageId: z.string().optional(),
  pendingDecision: z.boolean().optional(),
  abandoned: z.boolean().optional(),
});

/**
 * Turno outbound no detalhe da conversa. `origin` é obrigatório — o mapper
 * sempre o preenche (default `"bot"` para turnos gravados antes desta mudança).
 * `kind` só vem em turnos de origem `operator` (`"manual"` avulsa | `"prospecting"`
 * primeiro contato); ausente nos turnos do bot.
 */
export const conversationDetailOutboundTurnSchema = z.object({
  direction: z.literal("outbound"),
  text: z.string(),
  timestamp: isoDateStringSchema,
  origin: outboundTurnOriginSchema,
  kind: outboundTurnKindSchema.optional(),
  leadIntent: leadIntentSchema.optional(),
  leadQualification: leadQualificationSchema.nullable().optional(),
  reasoning: z.string().nullable().optional(),
  recommendedModules: z.array(moduleIdSchema).optional(),
  interestedModules: z.array(moduleIdSchema).optional(),
  quotedPlan: commercialPlanSchema.nullable().optional(),
});

/** Um turno serializado no detalhe da conversa. */
export const conversationDetailTurnSchema = z.discriminatedUnion("direction", [
  conversationDetailInboundTurnSchema,
  conversationDetailOutboundTurnSchema,
]);

export type ConversationDetailOutboundTurn = z.infer<typeof conversationDetailOutboundTurnSchema>;

/** Detalhe completo, lido da fonte da verdade (arquivo do lead). */
export const conversationDetailSchema = z.object({
  leadPhone: z.string(),
  state: conversationStateSchema,
  leadIntent: leadIntentSchema,
  leadQualification: leadQualificationSchema.nullable(),
  recommendedModules: z.array(moduleIdSchema),
  interestedModules: z.array(moduleIdSchema),
  quotedPlan: commercialPlanSchema.nullable(),
  hasPendingInbound: z.boolean(),
  hasAbandonedInbound: z.boolean(),
  turnCount: z.number().int().nonnegative(),
  lastActivityAt: isoDateStringSchema.nullable(),
  turns: z.array(conversationDetailTurnSchema),
});

export type ConversationDetail = z.infer<typeof conversationDetailSchema>;
