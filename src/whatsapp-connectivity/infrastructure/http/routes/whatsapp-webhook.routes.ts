import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { HandleInboundMessageUseCase } from "../../../application/use-cases/handle-inbound-message.use-case.ts";
import type { HandleMessageStatusUpdateUseCase } from "../../../application/use-cases/handle-message-status-update.use-case.ts";
import type { Logger } from "../../../application/ports/logger.port.ts";
import { extractWebhookEvents, webhookPayloadSchema } from "../../webhook/webhook-event.schema.ts";
import { isValidWebhookSignature } from "../webhook-signature.guard.ts";

const verifyQuerySchema = z.object({
  "hub.mode": z.string().optional(),
  "hub.verify_token": z.string().optional(),
  "hub.challenge": z.string().optional(),
});

export interface WhatsappWebhookRoutesDeps {
  handleInboundMessage: HandleInboundMessageUseCase;
  handleMessageStatusUpdate: HandleMessageStatusUpdateUseCase;
  logger: Logger;
  webhookVerifyToken: string;
  appSecret: string;
}

export const registerWhatsappWebhookRoutes: FastifyPluginAsync<WhatsappWebhookRoutesDeps> = async (
  app,
  deps,
) => {
  // Corpo bruto (Buffer) é necessário para validar a assinatura HMAC antes do parse — escopado
  // a este plugin para não afetar o parsing JSON padrão de outras rotas futuras.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, payload, done) => {
    done(null, payload);
  });

  app.get("/webhooks/whatsapp", async (request, reply) => {
    const result = verifyQuerySchema.safeParse(request.query);

    if (!result.success) {
      return reply.code(403).send();
    }

    const mode = result.data["hub.mode"];
    const verifyToken = result.data["hub.verify_token"];
    const challenge = result.data["hub.challenge"];

    if (
      mode === "subscribe" &&
      verifyToken === deps.webhookVerifyToken &&
      challenge !== undefined
    ) {
      return reply.code(200).send(challenge);
    }

    return reply.code(403).send();
  });

  app.post("/webhooks/whatsapp", async (request, reply) => {
    const rawBody = request.body as Buffer;
    const signatureHeader = request.headers["x-hub-signature-256"];

    const isValid = isValidWebhookSignature({
      rawBody,
      signatureHeader: Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader,
      appSecret: deps.appSecret,
    });

    if (!isValid) {
      deps.logger.warn("Assinatura de webhook ausente ou inválida — evento rejeitado", {
        hasSignatureHeader: signatureHeader !== undefined,
      });
      return reply.code(401).send();
    }

    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return reply.code(400).send();
    }

    const parsed = webhookPayloadSchema.safeParse(json);

    if (!parsed.success) {
      deps.logger.warn("Payload de webhook inválido recebido", { issues: parsed.error.issues });
      return reply.code(200).send();
    }

    for (const event of extractWebhookEvents(parsed.data)) {
      if (event.type === "message") {
        void Promise.resolve()
          .then(() => deps.handleInboundMessage.execute(event.message))
          .catch((error: unknown) =>
            deps.logger.error("Falha ao processar mensagem inbound", { error }),
          );
      } else if (event.type === "status") {
        void Promise.resolve()
          .then(() => deps.handleMessageStatusUpdate.execute(event.status))
          .catch((error: unknown) =>
            deps.logger.error("Falha ao processar atualização de status", { error }),
          );
      } else {
        deps.logger.warn("Evento de webhook de tipo não suportado ignorado");
      }
    }

    return reply.code(200).send();
  });
};
