import type { FastifyPluginAsync } from "fastify";
import type { ConversationRepositoryPort } from "../../../conversation-engine/application/ports/conversation-repository.port.ts";
import { toConversationDetail } from "../../interface/conversation-detail.mapper.ts";
import {
  conversationDetailSchema,
  conversationListPageSchema,
} from "../../interface/dto/conversation.dto.ts";
import { conversationListQuerySchema } from "../../interface/dto/query.ts";
import type { ConversationIndexQueries } from "../persistence/conversation-index-queries.ts";
import { replyWithContract } from "./reply-with-contract.ts";

export interface AdminConversationsRoutesDeps {
  queries: ConversationIndexQueries;
  repository: ConversationRepositoryPort;
}

/** `GET /api/conversations` (lista da projeção) e `GET /api/conversations/:leadPhone` (detalhe do arquivo). */
export const registerAdminConversationsRoutes: FastifyPluginAsync<
  AdminConversationsRoutesDeps
> = async (app, deps) => {
  app.get("/api/conversations", async (request, reply) => {
    const parsed = conversationListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", issues: parsed.error.issues });
    }

    const page = deps.queries.list(parsed.data);
    return replyWithContract(reply, conversationListPageSchema, page);
  });

  app.get<{ Params: { leadPhone: string } }>(
    "/api/conversations/:leadPhone",
    async (request, reply) => {
      const conversation = await deps.repository.load(request.params.leadPhone);
      if (conversation === null) {
        return reply.code(404).send({ error: "not_found" });
      }
      return replyWithContract(reply, conversationDetailSchema, toConversationDetail(conversation));
    },
  );
};
