import type { FastifyPluginAsync } from "fastify";
import type { ConsumptionStatsService } from "../../application/consumption-stats.service.ts";
import { consumptionSeriesSchema } from "../../interface/dto/consumption.dto.ts";
import { overviewSchema } from "../../interface/dto/overview.dto.ts";
import { consumptionQuerySchema } from "../../interface/dto/query.ts";
import type { ConversationIndexQueries } from "../persistence/conversation-index-queries.ts";
import { replyWithContract } from "./reply-with-contract.ts";

export interface AdminStatsRoutesDeps {
  consumptionStats: ConsumptionStatsService;
  queries: ConversationIndexQueries;
}

/** `GET /api/stats/consumption` (agregações de consumo) e `GET /api/stats/overview` (contadores do "agora"). */
export const registerAdminStatsRoutes: FastifyPluginAsync<AdminStatsRoutesDeps> = async (
  app,
  deps,
) => {
  app.get("/api/stats/consumption", async (request, reply) => {
    const parsed = consumptionQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", issues: parsed.error.issues });
    }

    const series = deps.consumptionStats.getSeries({
      from: new Date(parsed.data.from),
      to: new Date(parsed.data.to),
      groupBy: parsed.data.groupBy,
    });
    return replyWithContract(reply, consumptionSeriesSchema, series);
  });

  app.get("/api/stats/overview", async (_request, reply) => {
    return replyWithContract(reply, overviewSchema, deps.queries.overview());
  });
};
