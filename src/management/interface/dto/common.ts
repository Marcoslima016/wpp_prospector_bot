import { z } from "zod";
import { LEAD_INTENTS } from "../../../conversation-engine/domain/lead-intent.ts";
import { LEAD_QUALIFICATIONS } from "../../../conversation-engine/domain/lead-qualification.ts";
import { COMMERCIAL_PLANS, MODULE_IDS } from "../../../conversation-engine/domain/product-catalog.ts";

/**
 * Versão dos contratos de resposta da API de gestão. Faça bump ao alterar a
 * forma de qualquer DTO de forma incompatível — o cliente da UI usa isto para
 * detectar divergência.
 */
export const MANAGEMENT_CONTRACT_VERSION = "2026-09-02";

/** Estados do ciclo de vida da conversa expostos como filtro e na listagem. */
export const CONVERSATION_STATES = ["active", "ended", "awaitingHuman"] as const;

/** Origem de um turno outbound: gerado pelo bot ou escrito por um operador. */
export const OUTBOUND_TURN_ORIGINS = ["bot", "operator"] as const;

/** Natureza de um turno outbound de operador: mensagem avulsa ou primeiro contato de prospecção. */
export const OUTBOUND_TURN_KINDS = ["manual", "prospecting"] as const;

/** Estado de prospecção de um lead. */
export const PROSPECTING_STATES = ["pending", "sent", "replied", "failed"] as const;

export const conversationStateSchema = z.enum(CONVERSATION_STATES);
export const outboundTurnOriginSchema = z.enum(OUTBOUND_TURN_ORIGINS);
export const outboundTurnKindSchema = z.enum(OUTBOUND_TURN_KINDS);
export const prospectingStateSchema = z.enum(PROSPECTING_STATES);
export const leadIntentSchema = z.enum(LEAD_INTENTS);
export const leadQualificationSchema = z.enum(LEAD_QUALIFICATIONS);
export const commercialPlanSchema = z.enum(COMMERCIAL_PLANS);
export const moduleIdSchema = z.enum(MODULE_IDS);

/** String em ISO 8601 aceita por `Date.parse` (usada em datas de resposta e filtros). */
export const isoDateStringSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), { error: "data ISO 8601 inválida" });
