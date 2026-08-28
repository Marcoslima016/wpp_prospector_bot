import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InboundMessageDto } from "../../../whatsapp-connectivity/application/ports/inbound-message.port.ts";
import type { ConversationRepositoryPort } from "../../application/ports/conversation-repository.port.ts";
import type { Logger } from "../../application/ports/logger.port.ts";
import { BotDecision } from "../../domain/bot-decision.ts";
import { Conversation } from "../../domain/conversation.ts";
import { InboundBatchCoordinator, type GenerateReplyPort } from "./inbound-batch-coordinator.ts";

const WINDOW = 8000;
const PHONE = "+5511999999999";

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

class InMemoryRepository implements ConversationRepositoryPort {
  store = new Map<string, Conversation>();

  seed(conversation: Conversation): void {
    this.store.set(conversation.leadPhone, conversation);
  }

  load(leadPhone: string): Promise<Conversation | null> {
    return Promise.resolve(this.store.get(leadPhone) ?? null);
  }

  save(conversation: Conversation): Promise<void> {
    this.store.set(conversation.leadPhone, conversation);
    return Promise.resolve();
  }

  findConversationsWithPendingInbound(): Promise<Conversation[]> {
    return Promise.resolve([...this.store.values()].filter((c) => c.pendingInboundTurns.length > 0));
  }
}

class RecordingGenerateReply implements GenerateReplyPort {
  calls: Array<{ leadPhone: string; messageIds: string[] }> = [];

  execute(leadPhone: string, messageIds: string[]): Promise<void> {
    this.calls.push({ leadPhone, messageIds: [...messageIds] });
    return Promise.resolve();
  }
}

function dto(messageId: string, text = "oi"): InboundMessageDto {
  return { from: PHONE, messageId, text, timestamp: new Date("2026-08-27T12:00:00.000Z") };
}

let repo: InMemoryRepository;
let generateReply: RecordingGenerateReply;
let logger: Logger;
let coordinator: InboundBatchCoordinator;

beforeEach(() => {
  vi.useFakeTimers();
  repo = new InMemoryRepository();
  generateReply = new RecordingGenerateReply();
  logger = fakeLogger();
  coordinator = new InboundBatchCoordinator({
    repository: repo,
    generateReply,
    logger,
    batchWindowMs: WINDOW,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("InboundBatchCoordinator", () => {
  it("normaliza o telefone do lead para E.164 (webhook envia sem `+`)", async () => {
    coordinator.receive({
      from: "5516991166257",
      messageId: "wamid.1",
      text: "oi",
      timestamp: new Date("2026-08-28T12:00:00.000Z"),
    });
    await coordinator.whenSettled();
    await vi.advanceTimersByTimeAsync(WINDOW);
    await coordinator.whenSettled();

    expect(generateReply.calls).toEqual([
      { leadPhone: "+5516991166257", messageIds: ["wamid.1"] },
    ]);
    expect(repo.store.has("+5516991166257")).toBe(true);
  });

  it("agrupa mensagens recebidas dentro da janela em uma única execução", async () => {
    coordinator.receive(dto("wamid.1"));
    coordinator.receive(dto("wamid.2"));
    coordinator.receive(dto("wamid.3"));
    await coordinator.whenSettled();

    await vi.advanceTimersByTimeAsync(WINDOW);
    await coordinator.whenSettled();

    expect(generateReply.calls).toEqual([
      { leadPhone: PHONE, messageIds: ["wamid.1", "wamid.2", "wamid.3"] },
    ]);
    expect(repo.store.get(PHONE)!.turns).toHaveLength(3);
  });

  it("mensagem após a janela abre um novo grupo", async () => {
    coordinator.receive(dto("wamid.1"));
    await coordinator.whenSettled();
    await vi.advanceTimersByTimeAsync(WINDOW);
    await coordinator.whenSettled();

    coordinator.receive(dto("wamid.2"));
    await coordinator.whenSettled();
    await vi.advanceTimersByTimeAsync(WINDOW);
    await coordinator.whenSettled();

    expect(generateReply.calls).toEqual([
      { leadPhone: PHONE, messageIds: ["wamid.1"] },
      { leadPhone: PHONE, messageIds: ["wamid.2"] },
    ]);
  });

  it("processa os grupos na ordem em que as janelas fecharam", async () => {
    coordinator.receive(dto("wamid.1"));
    coordinator.receive(dto("wamid.2"));
    await coordinator.whenSettled();
    await vi.advanceTimersByTimeAsync(WINDOW);

    coordinator.receive(dto("wamid.3"));
    await coordinator.whenSettled();
    await vi.advanceTimersByTimeAsync(WINDOW);
    await coordinator.whenSettled();

    expect(generateReply.calls.map((c) => c.messageIds)).toEqual([
      ["wamid.1", "wamid.2"],
      ["wamid.3"],
    ]);
  });

  it("quando a conversa aguarda humano, apenas registra o inbound sem agendar processamento", async () => {
    const conversation = Conversation.createNew(PHONE);
    conversation.recordInboundTurn({
      text: "quero falar com alguém",
      timestamp: new Date(),
      messageId: "wamid.0",
    });
    conversation.applyDecision(
      BotDecision.create({
        replyMessages: ["Vou te transferir."],
        endConversation: false,
        leadIntent: "interested",
        leadQualification: "hot",
        handoffToHuman: true,
        reasoning: null,
      }),
    );
    repo.seed(conversation);

    coordinator.receive(dto("wamid.1", "ainda aí?"));
    await coordinator.whenSettled();
    await vi.advanceTimersByTimeAsync(WINDOW);
    await coordinator.whenSettled();

    expect(generateReply.calls).toHaveLength(0);
    expect(repo.store.get(PHONE)!.turns.some((t) => t.text === "ainda aí?")).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("aguardando atendimento humano"),
      expect.objectContaining({ messageId: "wamid.1" }),
    );
  });

  it("ignora webhook reentregue com messageId já processado", async () => {
    coordinator.receive(dto("wamid.1"));
    await coordinator.whenSettled();
    await vi.advanceTimersByTimeAsync(WINDOW);
    await coordinator.whenSettled();

    coordinator.receive(dto("wamid.1"));
    await coordinator.whenSettled();
    await vi.advanceTimersByTimeAsync(WINDOW);
    await coordinator.whenSettled();

    expect(generateReply.calls).toHaveLength(1);
    expect(logger.info).toHaveBeenCalledWith(
      "Mensagem inbound duplicada ignorada",
      expect.objectContaining({ messageId: "wamid.1" }),
    );
  });

  it("enqueuePendingBatch dispara o processamento imediatamente na fila serial", async () => {
    coordinator.enqueuePendingBatch(PHONE, ["wamid.1", "wamid.2"]);
    await coordinator.whenSettled();

    expect(generateReply.calls).toEqual([
      { leadPhone: PHONE, messageIds: ["wamid.1", "wamid.2"] },
    ]);
  });
});
