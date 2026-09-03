import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ConversationRepositoryPort } from "./conversation-engine/application/ports/conversation-repository.port.ts";
import { GenerateReplyUseCase } from "./conversation-engine/application/use-cases/generate-reply.use-case.ts";
import { loadConversationEngineEnv } from "./conversation-engine/infrastructure/config/env.ts";
import { PendingInboundSweeper } from "./conversation-engine/infrastructure/boot/pending-inbound-sweeper.ts";
import { InboundBatchCoordinator } from "./conversation-engine/infrastructure/inbound/inbound-batch-coordinator.ts";
import { loadKnowledge } from "./conversation-engine/infrastructure/knowledge/knowledge-loader.ts";
import { LexicalRetrievalBusinessContext } from "./conversation-engine/infrastructure/knowledge/lexical-retrieval.business-context.ts";
import { AnthropicLlmClient } from "./conversation-engine/infrastructure/llm/anthropic-llm-client.ts";
import { FileConversationRepository } from "./conversation-engine/infrastructure/persistence/file-conversation-repository.ts";
import { NoopUsageRecorder } from "./conversation-engine/infrastructure/persistence/noop-usage-recorder.ts";
import { SqliteUsageRecorder } from "./conversation-engine/infrastructure/persistence/sqlite-usage-recorder.ts";
import { ReplySenderAdapter } from "./conversation-engine/infrastructure/sending/reply-sender.adapter.ts";
import { ReplyStrategy } from "./conversation-engine/domain/reply-strategy.ts";
import { loadManagementEnv, resolveAdminConfig } from "./management/infrastructure/config/env.ts";
import { ConversationIndexProjection } from "./management/infrastructure/persistence/conversation-index-projection.ts";
import { IndexingConversationRepository } from "./management/infrastructure/persistence/indexing-conversation-repository.ts";
import { openDatabase } from "./shared/persistence/sqlite/open-database.ts";
import { HandleInboundMessageUseCase } from "./whatsapp-connectivity/application/use-cases/handle-inbound-message.use-case.ts";
import { HandleMessageStatusUpdateUseCase } from "./whatsapp-connectivity/application/use-cases/handle-message-status-update.use-case.ts";
import { SendOutboundMessageUseCase } from "./whatsapp-connectivity/application/use-cases/send-outbound-message.use-case.ts";
import { SendTextMessageUseCase } from "./whatsapp-connectivity/application/use-cases/send-text-message.use-case.ts";
import { loadEnv } from "./whatsapp-connectivity/infrastructure/config/env.ts";
import { MetaCloudApiGateway } from "./whatsapp-connectivity/infrastructure/gateways/meta-cloud-api.gateway.ts";
import { NoopMessagingCostRecorder } from "./whatsapp-connectivity/infrastructure/persistence/noop-messaging-cost-recorder.ts";
import { SqliteMessagingCostRecorder } from "./whatsapp-connectivity/infrastructure/persistence/sqlite-messaging-cost-recorder.ts";
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
  join(
    dirname(fileURLToPath(import.meta.url)),
    "conversation-engine/domain/reply-strategy.prompt.md",
  ),
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

// Base de conhecimento comercial: preparada no boot. Fail-fast — se a base não
// construir (arquivo ausente, `.md` malformado, metadado faltando, zero
// trechos), o processo não sobe.
let knowledge: ReturnType<typeof loadKnowledge>;
try {
  knowledge = loadKnowledge(conversationEnv.KNOWLEDGE_DIR);
  logger.info("Base de conhecimento comercial preparada", {
    chunks: knowledge.chunks.length,
    pinned: knowledge.chunks.filter((c) => c.pinned).length,
  });
} catch (error) {
  console.error(
    "Falha ao preparar a base de conhecimento comercial — abortando a inicialização",
    error,
  );
  process.exit(1);
}

// Armazenamento SQL embutido (node:sqlite): preparado no boot, antes de montar
// os use-cases e antes do `app.listen`. Fail-fast — se abrir o banco ou aplicar
// uma migration falhar, o processo não sobe. A conexão fica disponível para
// injeção nos adapters das próximas changes; nenhuma consome nesta change.
let database: ReturnType<typeof openDatabase>;
try {
  database = openDatabase(conversationEnv.DATABASE_PATH);
  logger.info("Armazenamento SQL embutido preparado", {
    path: conversationEnv.DATABASE_PATH,
  });
} catch (error) {
  console.error(
    "Falha ao preparar o armazenamento SQL embutido — abortando a inicialização",
    error,
  );
  process.exit(1);
}

// Registro append-only de consumo de tokens de cada chamada ao LLM. Desligado
// por config, usa o recorder no-op e o fluxo opera como sem a feature.
const usageRecorder = conversationEnv.LLM_USAGE_TRACKING_ENABLED
  ? new SqliteUsageRecorder(database, logger)
  : new NoopUsageRecorder();

const businessContextProvider = new LexicalRetrievalBusinessContext({
  llmClient,
  index: knowledge.index,
  pinnedContext: knowledge.pinnedContext,
  extractionModel: conversationEnv.EXTRACTION_LLM_MODEL,
  topK: conversationEnv.RETRIEVAL_TOP_K,
  minScore: conversationEnv.RETRIEVAL_MIN_SCORE,
  usageRecorder,
  logger,
});

// API de gestão (/admin): quando ligada, o repositório de conversas é embrulhado
// por um decorator que mantém a projeção de leitura (`conversation_index`) em
// sincronia a cada `save()`. O motor recebe um `ConversationRepositoryPort` e não
// sabe da projeção. Desligada, usa o `FileConversationRepository` puro.
const managementEnv = loadManagementEnv();
const adminConfig = resolveAdminConfig(managementEnv);

let conversationIndexProjection: ConversationIndexProjection | undefined;
let conversationRepository: ConversationRepositoryPort = new FileConversationRepository(
  conversationEnv.CONVERSATIONS_DIR,
);
if (adminConfig) {
  conversationIndexProjection = new ConversationIndexProjection(database);
  conversationRepository = new IndexingConversationRepository(
    conversationRepository,
    conversationIndexProjection,
    logger,
  );
}

const replySender = new ReplySenderAdapter({ sendTextMessage, logger });

// Conexão única do armazenamento SQL embutido. Consumida pelo `SqliteUsageRecorder`
// (consumo de LLM) e exposta para os adapters das próximas changes (consumo de
// WhatsApp, projeção de leitura de conversas).
export { database };

const generateReply = new GenerateReplyUseCase({
  repository: conversationRepository,
  replyStrategy,
  llmClient,
  replySender,
  businessContextProvider,
  usageRecorder,
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

// Registro append-only das janelas de conversa de 24 h faturáveis (fonte
// WhatsApp da capability `consumption-metrics`). Best-effort; desligado por
// config, usa o recorder no-op e o tratamento de status opera como sem a feature.
const messagingCostRecorder = env.WHATSAPP_COST_TRACKING_ENABLED
  ? new SqliteMessagingCostRecorder(database, logger, env.WHATSAPP_BILLING_COUNTRY)
  : new NoopMessagingCostRecorder();
const handleMessageStatusUpdate = new HandleMessageStatusUpdateUseCase(
  logger,
  messagingCostRecorder,
);

export const app = buildFastifyServer({
  webhook: {
    handleInboundMessage,
    handleMessageStatusUpdate,
    logger,
    webhookVerifyToken: env.META_WEBHOOK_VERIFY_TOKEN,
    appSecret: env.META_APP_SECRET,
  },
  admin: adminConfig
    ? { config: adminConfig, db: database, repository: conversationRepository, logger }
    : undefined,
});

const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  const boot = async (): Promise<void> => {
    if (conversationIndexProjection && conversationIndexProjection.isEmptyOrStale()) {
      const indexed = await conversationIndexProjection.rebuildFromDir(
        conversationEnv.CONVERSATIONS_DIR,
      );
      logger.info("Projeção de conversas (/admin) reconstruída no boot", { conversations: indexed });
    }

    await pendingInboundSweeper.run().catch((error: unknown) =>
      logger.error("Falha na varredura de mensagens inbound pendentes no boot", {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  };

  boot()
    .catch((error: unknown) =>
      logger.error("Falha na preparação do boot", {
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
