import { describe, expect, it, vi } from "vitest";
import type { ConversationRepositoryPort } from "../../application/ports/conversation-repository.port.ts";
import type { Logger } from "../../application/ports/logger.port.ts";
import { BotDecision } from "../../domain/bot-decision.ts";
import { Conversation } from "../../domain/conversation.ts";
import { PendingInboundSweeper, type PendingBatchEnqueuer } from "./pending-inbound-sweeper.ts";

const NOW = new Date("2026-08-27T12:00:00.000Z");
const MAX_AGE = 3_600_000; // 1h

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

class StubRepository implements ConversationRepositoryPort {
  saved: Conversation[] = [];
  constructor(private readonly pending: Conversation[]) {}

  load(): Promise<Conversation | null> {
    return Promise.resolve(null);
  }
  save(conversation: Conversation): Promise<void> {
    this.saved.push(conversation);
    return Promise.resolve();
  }
  findConversationsWithPendingInbound(): Promise<Conversation[]> {
    return Promise.resolve(this.pending);
  }
}

function conversationWithPendingAt(leadPhone: string, at: Date, messageId: string): Conversation {
  const conversation = Conversation.createNew(leadPhone);
  conversation.recordInboundTurn({ text: "pendente", timestamp: at, messageId });
  return conversation;
}

function build(pending: Conversation[]): {
  sweeper: PendingInboundSweeper;
  repo: StubRepository;
  coordinator: PendingBatchEnqueuer & { calls: Array<{ leadPhone: string; messageIds: string[] }> };
  logger: Logger;
} {
  const repo = new StubRepository(pending);
  const logger = fakeLogger();
  const calls: Array<{ leadPhone: string; messageIds: string[] }> = [];
  const coordinator = {
    calls,
    enqueuePendingBatch(leadPhone: string, messageIds: string[]) {
      calls.push({ leadPhone, messageIds });
    },
  };
  const sweeper = new PendingInboundSweeper({
    repository: repo,
    coordinator,
    logger,
    maxAgeMs: MAX_AGE,
    clock: () => NOW,
  });
  return { sweeper, repo, coordinator, logger };
}

describe("PendingInboundSweeper", () => {
  it("reenfileira pendência recente no coordenador", async () => {
    const recent = conversationWithPendingAt(
      "+5511111111111",
      new Date(NOW.getTime() - 10_000),
      "wamid.recent",
    );
    const { sweeper, coordinator, repo } = build([recent]);

    await sweeper.run();

    expect(coordinator.calls).toEqual([
      { leadPhone: "+5511111111111", messageIds: ["wamid.recent"] },
    ]);
    expect(repo.saved).toHaveLength(0);
  });

  it("marca pendência antiga como abandonada e persiste, sem reenfileirar", async () => {
    const old = conversationWithPendingAt(
      "+5522222222222",
      new Date(NOW.getTime() - MAX_AGE - 1),
      "wamid.old",
    );
    const { sweeper, coordinator, repo, logger } = build([old]);

    await sweeper.run();

    expect(coordinator.calls).toHaveLength(0);
    expect(repo.saved).toHaveLength(1);
    expect(repo.saved[0]!.pendingInboundTurns).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("abandonada"),
      expect.objectContaining({ leadPhone: "+5522222222222" }),
    );
  });

  it("ignora conversas sem turnos pendentes", async () => {
    const answered = Conversation.createNew("+5533333333333");
    answered.recordInboundTurn({ text: "oi", timestamp: NOW, messageId: "wamid.1" });
    answered.applyDecision(
      BotDecision.create({
        replyMessages: ["olá"],
        endConversation: false,
        leadIntent: "interested",
        leadQualification: "warm",
        handoffToHuman: false,
        reasoning: null,
      }),
      NOW,
    );
    const { sweeper, coordinator, repo } = build([answered]);

    await sweeper.run();

    expect(coordinator.calls).toHaveLength(0);
    expect(repo.saved).toHaveLength(0);
  });
});
