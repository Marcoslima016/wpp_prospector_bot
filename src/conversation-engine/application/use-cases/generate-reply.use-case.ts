import { BotDecision } from "../../domain/bot-decision.ts";
import { Conversation } from "../../domain/conversation.ts";
import type { ReplyStrategy } from "../../domain/reply-strategy.ts";
import { InterpretationError } from "../errors.ts";
import type { ConversationRepositoryPort } from "../ports/conversation-repository.port.ts";
import type { LlmClientPort } from "../ports/llm-client.port.ts";
import type { Logger } from "../ports/logger.port.ts";
import type { ReplySenderPort } from "../ports/reply-sender.port.ts";

export interface GenerateReplyUseCaseDeps {
  repository: ConversationRepositoryPort;
  replyStrategy: ReplyStrategy;
  llmClient: LlmClientPort;
  replySender: ReplySenderPort;
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
  private readonly logger: Logger;
  private readonly clock: () => Date;
  private readonly retryBackoffMs: number;

  constructor(deps: GenerateReplyUseCaseDeps) {
    this.repository = deps.repository;
    this.replyStrategy = deps.replyStrategy;
    this.llmClient = deps.llmClient;
    this.replySender = deps.replySender;
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
    const request = this.replyStrategy.buildRequest(conversation, newMessages);

    let decision: BotDecision;
    try {
      decision = await this.interpretWithRetry(request);
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
  ): Promise<BotDecision> {
    try {
      return await this.interpretOnce(request);
    } catch (firstError) {
      await sleep(this.retryBackoffMs);
      try {
        return await this.interpretOnce(request);
      } catch (secondError) {
        throw secondError instanceof Error ? secondError : new Error(String(firstError));
      }
    }
  }

  private async interpretOnce(
    request: ReturnType<ReplyStrategy["buildRequest"]>,
  ): Promise<BotDecision> {
    const response = await this.llmClient.generate(request);

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.text);
    } catch (cause) {
      throw new InterpretationError("Resposta do LLM não é um JSON válido", { cause });
    }

    return BotDecision.create(parsed as Parameters<typeof BotDecision.create>[0]);
  }
}
