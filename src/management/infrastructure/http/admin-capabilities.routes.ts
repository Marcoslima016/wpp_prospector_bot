import type { FastifyPluginAsync } from "fastify";
import { capabilitiesSchema } from "../../interface/dto/capabilities.dto.ts";
import { replyWithContract } from "./reply-with-contract.ts";

export interface AdminCapabilitiesRoutesDeps {
  /** Famílias de ação montadas neste processo. */
  conversationActions: boolean;
  prospecting: boolean;
}

/**
 * `GET /api/capabilities` — declara quais famílias de ação da superfície
 * `/admin/api/` estão disponíveis neste deploy. Reflete o que
 * `register-admin-routes` montou; a UI usa isto para exibir/ocultar afordâncias
 * sem depender de bater nas rotas e tratar `404`. Guarda de sessão herdada.
 */
export const registerAdminCapabilitiesRoutes: FastifyPluginAsync<
  AdminCapabilitiesRoutesDeps
> = async (app, deps) => {
  app.get("/api/capabilities", async (_request, reply) => {
    return replyWithContract(reply, capabilitiesSchema, {
      conversationActions: deps.conversationActions,
      prospecting: deps.prospecting,
    });
  });
};
