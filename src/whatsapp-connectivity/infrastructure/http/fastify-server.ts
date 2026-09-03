import Fastify, { type FastifyInstance } from "fastify";
import {
  registerAdminRoutes,
  type AdminRoutesDeps,
} from "../../../management/infrastructure/http/register-admin-routes.ts";
import {
  registerWhatsappWebhookRoutes,
  type WhatsappWebhookRoutesDeps,
} from "./routes/whatsapp-webhook.routes.ts";

export interface BuildFastifyServerOptions {
  webhook: WhatsappWebhookRoutesDeps;
  /**
   * Deps do plugin de gestão. Presente ⇒ `ADMIN_ENABLED` (o `main.ts` só
   * preenche quando ligada). Montado sob `/admin`, no mesmo processo, isolado do
   * webhook pelo encapsulamento do Fastify (design D1) — o parser de corpo bruto
   * do webhook é escopado ao plugin dele e não afeta `/admin`.
   */
  admin?: AdminRoutesDeps | undefined;
}

export function buildFastifyServer(options: BuildFastifyServerOptions): FastifyInstance {
  const app = Fastify();

  app.register(registerWhatsappWebhookRoutes, options.webhook);

  if (options.admin !== undefined) {
    app.register(registerAdminRoutes, { prefix: "/admin", ...options.admin });
  }

  return app;
}
