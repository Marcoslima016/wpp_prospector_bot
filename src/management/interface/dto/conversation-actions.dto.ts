import { z } from "zod";
import {
  conversationDetailOutboundTurnSchema,
  conversationDetailSchema,
} from "./conversation.dto.ts";

/**
 * Resultado de `POST /admin/api/conversations/:leadPhone/handoff` — o detalhe da
 * conversa já com o estado atualizado (`awaitingHuman`).
 */
export const handoffResultSchema = conversationDetailSchema;
export type HandoffResult = z.infer<typeof handoffResultSchema>;

/**
 * Resultado de `POST /admin/api/conversations/:leadPhone/resume` — o detalhe da
 * conversa já com o estado atualizado (`active`).
 */
export const resumeResultSchema = conversationDetailSchema;
export type ResumeResult = z.infer<typeof resumeResultSchema>;

/**
 * Resultado de `POST /admin/api/conversations/:leadPhone/messages` — confirmação
 * do envio e o turno outbound de origem `operator` registrado no histórico.
 */
export const sendMessageResultSchema = z.object({
  sent: z.literal(true),
  turn: conversationDetailOutboundTurnSchema,
});
export type SendMessageResult = z.infer<typeof sendMessageResultSchema>;
