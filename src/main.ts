import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GenerateReplyUseCase } from "./conversation-engine/application/use-cases/generate-reply.use-case.ts";
import { loadConversationEngineEnv } from "./conversation-engine/infrastructure/config/env.ts";
import { PendingInboundSweeper } from "./conversation-engine/infrastructure/boot/pending-inbound-sweeper.ts";
import { InboundBatchCoordinator } from "./conversation-engine/infrastructure/inbound/inbound-batch-coordinator.ts";
import { AnthropicLlmClient } from "./conversation-engine/infrastructure/llm/anthropic-llm-client.ts";
import { FileConversationRepository } from "./conversation-engine/infrastructure/persistence/file-conversation-repository.ts";
import { ReplySenderAdapter } from "./conversation-engine/infrastructure/sending/reply-sender.adapter.ts";
import { ReplyStrategy } from "./conversation-engine/domain/reply-strategy.ts";
import { HandleInboundMessageUseCase } from "./whatsapp-connectivity/application/use-cases/handle-inbound-message.use-case.ts";
import { HandleMessageStatusUpdateUseCase } from "./whatsapp-connectivity/application/use-cases/handle-message-status-update.use-case.ts";
import { SendOutboundMessageUseCase } from "./whatsapp-connectivity/application/use-cases/send-outbound-message.use-case.ts";
import { SendTextMessageUseCase } from "./whatsapp-connectivity/application/use-cases/send-text-message.use-case.ts";
import { loadEnv } from "./whatsapp-connectivity/infrastructure/config/env.ts";
import { MetaCloudApiGateway } from "./whatsapp-connectivity/infrastructure/gateways/meta-cloud-api.gateway.ts";
import { buildFastifyServer } from "./whatsapp-connectivity/infrastructure/http/fastify-server.ts";
import { ConsoleLogger } from "./whatsapp-connectivity/infrastructure/logging/console-logger.ts";

const env = loadEnv();
const conversationEnv = loadConversationEngineEnv();
const logger = new ConsoleLogger();

const gateway = new MetaCloudApiGateway({
  accessToken: env.META_ACCESS_TOKEN,
  phoneNumberId: env.META_PHONE_NUMBER_ID,
});

// Exportado para uso manual (ex.: validação de QA do envio do template `hello_world`),
// já que esta change ainda não expõe um gatilho HTTP para envio outbound.
export const sendOutboundMessage = new SendOutboundMessageUseCase(gateway);
// Exportado para uso manual (ex.: validação de QA do envio de texto livre dentro da
// janela de 24h), já que esta change ainda não expõe um gatilho HTTP para envio outbound.
export const sendTextMessage = new SendTextMessageUseCase(gateway);

// --- Motor de conversas (conversation-engine) ---
const promptText = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "conversation-engine/domain/reply-strategy.prompt.md"),
  "utf8",
);

const replyStrategy = new ReplyStrategy({
  promptText,
  model: conversationEnv.LLM_MODEL,
  historyTurns: conversationEnv.CONVERSATION_HISTORY_TURNS,
});
const llmClient = new AnthropicLlmClient({
  apiKey: conversationEnv.ANTHROPIC_API_KEY,
  workspaceId: conversationEnv.ANTHROPIC_WORKSPACE_ID,
});
const conversationRepository = new FileConversationRepository(conversationEnv.CONVERSATIONS_DIR);
const replySender = new ReplySenderAdapter({ sendTextMessage, logger });

const generateReply = new GenerateReplyUseCase({
  repository: conversationRepository,
  replyStrategy,
  llmClient,
  replySender,
  logger,
});

const inboundBatchCoordinator = new InboundBatchCoordinator({
  repository: conversationRepository,
  generateReply,
  logger,
  batchWindowMs: conversationEnv.CONVERSATION_BATCH_WINDOW_MS,
});

const pendingInboundSweeper = new PendingInboundSweeper({
  repository: conversationRepository,
  coordinator: inboundBatchCoordinator,
  logger,
  maxAgeMs: conversationEnv.BOOT_SWEEP_MAX_AGE_MS,
});

const handleInboundMessage = new HandleInboundMessageUseCase(logger, inboundBatchCoordinator);
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
  pendingInboundSweeper
    .run()
    .catch((error: unknown) =>
      logger.error("Falha na varredura de mensagens inbound pendentes no boot", {
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    .finally(() => {
      app
        .listen({ port: env.PORT, host: "0.0.0.0" })
        .then(() => logger.info("Servidor iniciado", { port: env.PORT }))
        .catch((error: unknown) => {
          console.error("Falha ao iniciar o servidor", error);
          process.exit(1);
        });
    });
}
