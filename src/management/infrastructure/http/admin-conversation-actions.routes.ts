import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import type { ConversationActionUseCase } from "../../application/conversation-action.use-case.ts";
import {
  ConversationNotFoundError,
  EmptyMessageTextError,
  SessionWindowClosedError,
} from "../../application/errors.ts";
import { toConversationDetail } from "../../interface/conversation-detail.mapper.ts";
import {
  handoffResultSchema,
  resumeResultSchema,
  sendMessageResultSchema,
} from "../../interface/dto/conversation-actions.dto.ts";
import { replyWithContract } from "./reply-with-contract.ts";

export interface AdminConversationActionsRoutesDeps {
  conversationActions: ConversationActionUseCase;
}

const sendMessageBodySchema = z.object({ text: z.string() });

/** Traduz os erros de aplicação das ações de operação para o HTTP. */
function replyWithActionError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof ConversationNotFoundError) {
    return reply.code(404).send({ error: "not_found" });
  }
  if (error instanceof SessionWindowClosedError) {
    return reply.code(409).send({ error: "session_window_closed", reason: error.reason });
  }
  if (error instanceof EmptyMessageTextError) {
    return reply.code(422).send({ error: "invalid_body", reason: error.message });
  }
  throw error;
}

/**
 * `POST /api/conversations/:leadPhone/handoff | /resume | /messages` — ações de
 * operação sobre uma conversa. Montadas sob o mesmo escopo coberto pela guarda de
 * sessão (`register-admin-routes`), então exigem sessão.
 */
export const registerAdminConversationActionsRoutes: FastifyPluginAsync<
  AdminConversationActionsRoutesDeps
> = async (app, deps) => {
  app.post<{ Params: { leadPhone: string } }>(
    "/api/conversations/:leadPhone/handoff",
    async (request, reply) => {
      try {
        const conversation = await deps.conversationActions.handoff(request.params.leadPhone);
        return replyWithContract(reply, handoffResultSchema, toConversationDetail(conversation));
      } catch (error) {
        return replyWithActionError(reply, error);
      }
    },
  );

  app.post<{ Params: { leadPhone: string } }>(
    "/api/conversations/:leadPhone/resume",
    async (request, reply) => {
      try {
        const conversation = await deps.conversationActions.resume(request.params.leadPhone);
        return replyWithContract(reply, resumeResultSchema, toConversationDetail(conversation));
      } catch (error) {
        return replyWithActionError(reply, error);
      }
    },
  );

  app.post<{ Params: { leadPhone: string } }>(
    "/api/conversations/:leadPhone/messages",
    async (request, reply) => {
      const parsed = sendMessageBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).send({ error: "invalid_body", issues: parsed.error.issues });
      }

      try {
        const conversation = await deps.conversationActions.sendMessage(
          request.params.leadPhone,
          parsed.data.text,
        );
        const lastTurn = toConversationDetail(conversation).turns.at(-1);
        if (lastTurn === undefined || lastTurn.direction !== "outbound") {
          throw new Error("turno outbound do operador não encontrado após o envio");
        }
        return replyWithContract(reply, sendMessageResultSchema, { sent: true, turn: lastTurn });
      } catch (error) {
        return replyWithActionError(reply, error);
      }
    },
  );
};
