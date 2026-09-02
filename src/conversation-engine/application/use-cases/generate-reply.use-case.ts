import { BotDecision } from "../../domain/bot-decision.ts";
import { Conversation } from "../../domain/conversation.ts";
import type { ReplyStrategy } from "../../domain/reply-strategy.ts";
import { InterpretationError } from "../errors.ts";
import type { BusinessContextProvider } from "../ports/business-context.port.ts";
import type { ConversationRepositoryPort } from "../ports/conversation-repository.port.ts";
import type { LlmClientPort } from "../ports/llm-client.port.ts";
import type { Logger } from "../ports/logger.port.ts";
import type { ReplySenderPort } from "../ports/reply-sender.port.ts";
import type { UsageRecorderPort } from "../ports/usage-recorder.port.ts";

export interface GenerateReplyUseCaseDeps {
  repository: ConversationRepositoryPort;
  replyStrategy: ReplyStrategy;
  llmClient: LlmClientPort;
  replySender: ReplySenderPort;
  businessContextProvider: BusinessContextProvider;
  usageRecorder: UsageRecorderPort;
  logger: Logger;
  clock?: () => Date;
  /** Backoff antes da tentativa adicional após uma falha de interpretação. */
  retryBackoffMs?: number;
}

const sleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

export class GenerateReplyUseCase {
  private readonly repository: ConversationRepositoryPort;
  private readonly replyStrategy: ReplyStrategy;
  private readonly llmClient: LlmClientPort;
  private readonly replySender: ReplySenderPort;
  private readonly businessContextProvider: BusinessContextProvider;
  private readonly usageRecorder: UsageRecorderPort;
  private readonly logger: Logger;
  private readonly clock: () => Date;
  private readonly retryBackoffMs: number;

  constructor(deps: GenerateReplyUseCaseDeps) {
    this.repository = deps.repository;
    this.replyStrategy = deps.replyStrategy;
    this.llmClient = deps.llmClient;
    this.replySender = deps.replySender;
    this.businessContextProvider = deps.businessContextProvider;
    this.usageRecorder = deps.usageRecorder;
    this.logger = deps.logger;
    this.clock = deps.clock ?? (() => new Date());
    this.retryBackoffMs = deps.retryBackoffMs ?? 500;
  }

  async execute(leadPhone: string, messageIds: string[]): Promise<void> {
    const conversation =
      (await this.repository.load(leadPhone)) ?? Conversation.createNew(leadPhone);

    const requested = new Set(messageIds);
    const pending = conversation.pendingInboundTurns.filter(
      (turn) => turn.messageId !== undefined && requested.has(turn.messageId),
    );

    if (pending.length === 0) {
      this.logger.info("Nenhuma mensagem pendente para o lote — nada a processar", {
        leadPhone,
        messageIds,
      });
      return;
    }

    conversation.reopenIfEnded();

    const newMessages = pending.map((turn) => turn.text);

    let businessContext = "";
    try {
      businessContext = await this.businessContextProvider.getContext({
        conversation,
        newMessages,
      });
    } catch (error) {
      this.logger.error(
        "Falha ao recuperar o contexto de negócio — seguindo sem trechos recuperados",
        {
          leadPhone,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const request = this.replyStrategy.buildRequest(conversation, newMessages, businessContext);

    let decision: BotDecision;
    try {
      decision = await this.interpretWithRetry(request, leadPhone);
    } catch (error) {
      this.logger.error("Falha ao interpretar mensagem do lead via LLM — sem resposta", {
        leadPhone,
        messageIds,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    conversation.applyDecision(decision, this.clock());
    await this.repository.save(conversation);

    for (const body of decision.replyMessages) {
      try {
        await this.replySender.send(leadPhone, body);
      } catch (error) {
        this.logger.error("Falha ao enviar uma das mensagens do lote — seguindo com as demais", {
          leadPhone,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (decision.handoffToHuman) {
      this.logger.warn("Conversa transferida para atendimento humano", { leadPhone });
    }
  }

  private async interpretWithRetry(
    request: ReturnType<ReplyStrategy["buildRequest"]>,
    leadPhone: string,
  ): Promise<BotDecision> {
    try {
      return await this.interpretOnce(request, leadPhone);
    } catch (firstError) {
      await sleep(this.retryBackoffMs);
      try {
        return await this.interpretOnce(request, leadPhone);
      } catch (secondError) {
        throw secondError instanceof Error ? secondError : new Error(String(firstError));
      }
    }
  }

  private async interpretOnce(
    request: ReturnType<ReplyStrategy["buildRequest"]>,
    leadPhone: string,
  ): Promise<BotDecision> {
    const response = await this.llmClient.generate(request);

    // A chamada retornou → foi faturada. Registra o consumo antes de parsear
    // (best-effort, fora do caminho crítico — nunca falha o turno).
    void this.usageRecorder
      .recordLlmCall({
        occurredAt: this.clock(),
        callType: "reply-generation",
        leadPhone,
        usage: response.usage,
      })
      .catch(() => {});

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.text);
    } catch (cause) {
      throw new InterpretationError("Resposta do LLM não é um JSON válido", { cause });
    }

    return BotDecision.create(parsed as Parameters<typeof BotDecision.create>[0]);
  }
}
