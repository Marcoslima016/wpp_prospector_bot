import { HandleInboundMessageUseCase } from "./whatsapp-connectivity/application/use-cases/handle-inbound-message.use-case.ts";
import { HandleMessageStatusUpdateUseCase } from "./whatsapp-connectivity/application/use-cases/handle-message-status-update.use-case.ts";
import { SendOutboundMessageUseCase } from "./whatsapp-connectivity/application/use-cases/send-outbound-message.use-case.ts";
import { loadEnv } from "./whatsapp-connectivity/infrastructure/config/env.ts";
import { MetaCloudApiGateway } from "./whatsapp-connectivity/infrastructure/gateways/meta-cloud-api.gateway.ts";
import { buildFastifyServer } from "./whatsapp-connectivity/infrastructure/http/fastify-server.ts";
import { ConsoleLogger } from "./whatsapp-connectivity/infrastructure/logging/console-logger.ts";

const env = loadEnv();
const logger = new ConsoleLogger();

const gateway = new MetaCloudApiGateway({
  accessToken: env.META_ACCESS_TOKEN,
  phoneNumberId: env.META_PHONE_NUMBER_ID,
});

// Exportado para uso manual (ex.: validação de QA do envio do template `hello_world`),
// já que esta change ainda não expõe um gatilho HTTP para envio outbound.
export const sendOutboundMessage = new SendOutboundMessageUseCase(gateway);
const handleInboundMessage = new HandleInboundMessageUseCase(logger);
const handleMessageStatusUpdate = new HandleMessageStatusUpdateUseCase(logger);

export const app = buildFastifyServer({
  handleInboundMessage,
  handleMessageStatusUpdate,
  logger,
  webhookVerifyToken: env.META_WEBHOOK_VERIFY_TOKEN,
  appSecret: env.META_APP_SECRET,
});

const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  app
    .listen({ port: env.PORT, host: "0.0.0.0" })
    .then(() => logger.info("Servidor iniciado", { port: env.PORT }))
    .catch((error: unknown) => {
      console.error("Falha ao iniciar o servidor", error);
      process.exit(1);
    });
}
