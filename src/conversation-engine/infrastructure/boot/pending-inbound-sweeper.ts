import type { ConversationRepositoryPort } from "../../application/ports/conversation-repository.port.ts";
import type { Logger } from "../../application/ports/logger.port.ts";

export interface PendingBatchEnqueuer {
  enqueuePendingBatch(leadPhone: string, messageIds: string[]): void;
}

export interface PendingInboundSweeperDeps {
  repository: ConversationRepositoryPort;
  coordinator: PendingBatchEnqueuer;
  logger: Logger;
  /** Limite de recência: pendências mais antigas que isso são abandonadas. */
  maxAgeMs: number;
  clock?: () => Date;
}

/**
 * Varredura de boot: reprocessa mensagens inbound que foram persistidas mas
 * nunca produziram uma decisão de resposta (ex.: processo reiniciou durante a
 * janela de coalescing).
 */
export class PendingInboundSweeper {
  private readonly repository: ConversationRepositoryPort;
  private readonly coordinator: PendingBatchEnqueuer;
  private readonly logger: Logger;
  private readonly maxAgeMs: number;
  private readonly clock: () => Date;

  constructor(deps: PendingInboundSweeperDeps) {
    this.repository = deps.repository;
    this.coordinator = deps.coordinator;
    this.logger = deps.logger;
    this.maxAgeMs = deps.maxAgeMs;
    this.clock = deps.clock ?? (() => new Date());
  }

  async run(): Promise<void> {
    const conversations = await this.repository.findConversationsWithPendingInbound();
    const now = this.clock().getTime();

    for (const conversation of conversations) {
      const pending = conversation.pendingInboundTurns;
      if (pending.length === 0) continue;

      const mostRecent = Math.max(...pending.map((turn) => turn.timestamp.getTime()));
      const ageMs = now - mostRecent;

      if (ageMs <= this.maxAgeMs) {
        const messageIds = pending
          .map((turn) => turn.messageId)
          .filter((id): id is string => id !== undefined);
        this.coordinator.enqueuePendingBatch(conversation.leadPhone, messageIds);
        this.logger.info("Pendência de inbound recente reenfileirada no boot", {
          leadPhone: conversation.leadPhone,
          messageIds,
        });
      } else {
        conversation.markPendingAbandoned();
        await this.repository.save(conversation);
        this.logger.warn("Pendência de inbound antiga marcada como abandonada no boot", {
          leadPhone: conversation.leadPhone,
          ageMs,
        });
      }
    }
  }
}
