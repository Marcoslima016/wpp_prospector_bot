import { describe, expect, it, vi } from "vitest";
import { BotDecision } from "../../conversation-engine/domain/bot-decision.ts";
import { Conversation } from "../../conversation-engine/domain/conversation.ts";
import { LeadSerialQueue } from "../../conversation-engine/infrastructure/inbound/lead-serial-queue.ts";
import { WhatsAppApiError } from "../../whatsapp-connectivity/application/errors.ts";
import type { SendTextMessageUseCase } from "../../whatsapp-connectivity/application/use-cases/send-text-message.use-case.ts";
import { InMemoryConversationRepository } from "../test-support/in-memory-conversation-repository.ts";
import { ConversationActionUseCase } from "./conversation-action.use-case.ts";
import {
  ConversationNotFoundError,
  EmptyMessageTextError,
  SessionWindowClosedError,
} from "./errors.ts";
import type { AdminActionAuditPort, AdminActionEntry } from "./ports/admin-action-audit.port.ts";
import type { Logger } from "./ports/logger.port.ts";

const PHONE = "+5511999999999";
const NOW = new Date("2026-09-02T12:00:00.000Z");

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

class RecordingAudit implements AdminActionAuditPort {
  entries: AdminActionEntry[] = [];
  record(entry: AdminActionEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }
}

function fakeSendText(impl?: () => Promise<{ wamid: string }>): {
  useCase: SendTextMessageUseCase;
  calls: Array<{ to: string; body: string }>;
} {
  const calls: Array<{ to: string; body: string }> = [];
  const useCase = {
    execute: (input: { to: string; body: string }) => {
      calls.push(input);
      return impl ? impl() : Promise.resolve({ wamid: "wamid.sent" });
    },
  } as unknown as SendTextMessageUseCase;
  return { useCase, calls };
}

interface Deps {
  repository: InMemoryConversationRepository;
  queue: LeadSerialQueue;
  audit: RecordingAudit;
  sendTextCalls: Array<{ to: string; body: string }>;
  useCase: ConversationActionUseCase;
}

function build(options: { sendText?: () => Promise<{ wamid: string }>; audit?: AdminActionAuditPort } = {}): Deps {
  const repository = new InMemoryConversationRepository();
  const queue = new LeadSerialQueue();
  const audit = new RecordingAudit();
  const { useCase: sendText, calls: sendTextCalls } = fakeSendText(options.sendText);
  const useCase = new ConversationActionUseCase({
    repository,
    queue,
    sendText,
    audit: options.audit ?? audit,
    logger: fakeLogger(),
    clock: () => NOW,
  });
  return { repository, queue, audit, sendTextCalls, useCase };
}

/** Conversa com um turno inbound `inboundAgeMs` atrás de `NOW` e um outbound do bot. */
function seedConversation(
  repository: InMemoryConversationRepository,
  opts: { state?: "active" | "ended" | "awaitingHuman"; inboundAgeMs?: number } = {},
): void {
  const conversation = Conversation.createNew(PHONE);
  conversation.recordInboundTurn({
    text: "oi",
    timestamp: new Date(NOW.getTime() - (opts.inboundAgeMs ?? 60_000)),
    messageId: "wamid.in.1",
  });
  conversation.applyDecision(
    BotDecision.create({
      replyMessages: ["resposta do bot"],
      endConversation: opts.state === "ended",
      leadIntent: "interested",
      leadQualification: "warm",
      handoffToHuman: opts.state === "awaitingHuman",
      reasoning: null,
    }),
    new Date(NOW.getTime() - 30_000),
  );
  repository.seed(conversation);
}

describe("ConversationActionUseCase — handoff", () => {
  it("coloca uma conversa ativa em atendimento humano, persiste e audita", async () => {
    const { repository, audit, useCase } = build();
    seedConversation(repository);

    const result = await useCase.handoff(PHONE);

    expect(result.state).toBe("awaitingHuman");
    expect((await repository.load(PHONE))!.state).toBe("awaitingHuman");
    expect(audit.entries).toEqual([
      { actor: "operator", action: "handoff", leadPhone: PHONE, occurredAt: NOW },
    ]);
  });

  it("é idempotente numa conversa já aguardando humano", async () => {
    const { repository, useCase } = build();
    seedConversation(repository, { state: "awaitingHuman" });

    await useCase.handoff(PHONE);
    const result = await useCase.handoff(PHONE);

    expect(result.state).toBe("awaitingHuman");
  });

  it("lança ConversationNotFoundError quando não há conversa", async () => {
    const { useCase } = build();
    await expect(useCase.handoff(PHONE)).rejects.toBeInstanceOf(ConversationNotFoundError);
  });
});

describe("ConversationActionUseCase — resume", () => {
  it("devolve uma conversa em atendimento humano para active", async () => {
    const { repository, audit, useCase } = build();
    seedConversation(repository, { state: "awaitingHuman" });

    const result = await useCase.resume(PHONE);

    expect(result.state).toBe("active");
    expect((await repository.load(PHONE))!.state).toBe("active");
    expect(audit.entries.map((e) => e.action)).toEqual(["resume"]);
  });

  it("reabre uma conversa encerrada", async () => {
    const { repository, useCase } = build();
    seedConversation(repository, { state: "ended" });

    const result = await useCase.resume(PHONE);

    expect(result.state).toBe("active");
  });

  it("lança ConversationNotFoundError quando não há conversa", async () => {
    const { useCase } = build();
    await expect(useCase.resume(PHONE)).rejects.toBeInstanceOf(ConversationNotFoundError);
  });
});

describe("ConversationActionUseCase — sendMessage", () => {
  it("dentro da janela: envia, registra um turno origin=operator e audita", async () => {
    const { repository, audit, sendTextCalls, useCase } = build();
    seedConversation(repository, { inboundAgeMs: 60_000 });

    const result = await useCase.sendMessage(PHONE, "Olá, tudo bem?");

    expect(sendTextCalls).toEqual([{ to: PHONE, body: "Olá, tudo bem?" }]);
    const lastTurn = result.turns.at(-1)!;
    expect(lastTurn.direction).toBe("outbound");
    expect(lastTurn.origin).toBe("operator");
    expect(lastTurn.text).toBe("Olá, tudo bem?");
    expect(audit.entries.map((e) => e.action)).toEqual(["send-message"]);
    expect((await repository.load(PHONE))!.turns.at(-1)!.origin).toBe("operator");
  });

  it("texto vazio → EmptyMessageTextError, sem enviar", async () => {
    const { repository, sendTextCalls, useCase } = build();
    seedConversation(repository);

    await expect(useCase.sendMessage(PHONE, "   ")).rejects.toBeInstanceOf(EmptyMessageTextError);
    expect(sendTextCalls).toHaveLength(0);
  });

  it("último inbound além de 24 h → SessionWindowClosedError, sem enviar nem registrar turno", async () => {
    const { repository, sendTextCalls, audit, useCase } = build();
    seedConversation(repository, { inboundAgeMs: 25 * 60 * 60 * 1000 });

    await expect(useCase.sendMessage(PHONE, "oi")).rejects.toBeInstanceOf(SessionWindowClosedError);
    expect(sendTextCalls).toHaveLength(0);
    expect(audit.entries).toHaveLength(0);
    const turns = (await repository.load(PHONE))!.turns;
    expect(turns.some((t) => t.origin === "operator")).toBe(false);
  });

  it("gateway recusa por re-engagement (131047) → SessionWindowClosedError, sem turno", async () => {
    const { repository, useCase } = build({
      sendText: () => Promise.reject(new WhatsAppApiError("Re-engagement message", { code: "131047" })),
    });
    seedConversation(repository, { inboundAgeMs: 60_000 });

    await expect(useCase.sendMessage(PHONE, "oi")).rejects.toBeInstanceOf(SessionWindowClosedError);
    const operatorTurns = (await repository.load(PHONE))!.turns.filter(
      (t) => t.origin === "operator",
    );
    expect(operatorTurns).toHaveLength(0);
  });

  it("erro genérico do gateway propaga (não vira SessionWindowClosedError)", async () => {
    const { repository, useCase } = build({
      sendText: () => Promise.reject(new WhatsAppApiError("Falha de rede", { code: "500" })),
    });
    seedConversation(repository, { inboundAgeMs: 60_000 });

    await expect(useCase.sendMessage(PHONE, "oi")).rejects.toBeInstanceOf(WhatsAppApiError);
  });

  it("lança ConversationNotFoundError quando não há conversa", async () => {
    const { useCase } = build();
    await expect(useCase.sendMessage(PHONE, "oi")).rejects.toBeInstanceOf(ConversationNotFoundError);
  });
});

describe("ConversationActionUseCase — auditoria e serialização", () => {
  it("uma falha ao auditar é logada e não falha a ação", async () => {
    const failingAudit: AdminActionAuditPort = {
      record: () => Promise.reject(new Error("db down")),
    };
    const logger = fakeLogger();
    const repository = new InMemoryConversationRepository();
    seedConversation(repository);
    const useCase = new ConversationActionUseCase({
      repository,
      queue: new LeadSerialQueue(),
      sendText: fakeSendText().useCase,
      audit: failingAudit,
      logger,
      clock: () => NOW,
    });

    const result = await useCase.handoff(PHONE);

    expect(result.state).toBe("awaitingHuman");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("auditoria"),
      expect.objectContaining({ action: "handoff", leadPhone: PHONE }),
    );
  });

  it("as ações passam pela fila serial do lead (esperam a tarefa anterior)", async () => {
    const { repository, queue, useCase } = build();
    seedConversation(repository);
    const events: string[] = [];

    let releasePrior!: () => void;
    const prior = queue.run(PHONE, async () => {
      await new Promise<void>((resolve) => {
        releasePrior = resolve;
      });
      events.push("prior");
    });

    const action = useCase.handoff(PHONE).then(() => {
      events.push("handoff");
    });

    await Promise.resolve();
    expect(events).toEqual([]);

    releasePrior();
    await Promise.all([prior, action]);

    expect(events).toEqual(["prior", "handoff"]);
  });
});
