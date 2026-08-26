import Fastify, { type FastifyInstance } from "fastify";
import {
  registerWhatsappWebhookRoutes,
  type WhatsappWebhookRoutesDeps,
} from "./routes/whatsapp-webhook.routes.ts";

export function buildFastifyServer(deps: WhatsappWebhookRoutesDeps): FastifyInstance {
  const app = Fastify();

  app.register(registerWhatsappWebhookRoutes, deps);

  return app;
}
