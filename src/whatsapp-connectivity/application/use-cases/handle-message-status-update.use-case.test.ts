import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../ports/logger.port.ts";
import type {
  MessagingCostRecorderPort,
  WhatsappConversationEvent,
} from "../ports/messaging-cost-recorder.port.ts";
import { HandleMessageStatusUpdateUseCase, type RawMessageStatusUpdate } from "./handle-message-status-update.use-case.ts";

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function recordingRecorder(): MessagingCostRecorderPort & { calls: WhatsappConversationEvent[] } {
  const calls: WhatsappConversationEvent[] = [];
  return {
    calls,
    recordConversationEvent: (event) => {
      calls.push(event);
      return Promise.resolve();
    },
  };
}

const BASE: RawMessageStatusUpdate = {
  id: "wamid.1",
  status: "sent",
  timestamp: "1700000000",
  recipient_id: "5511999999999",
};

const WITH_PRICING: RawMessageStatusUpdate = {
  ...BASE,
  pricing: { billable: true, pricing_model: "CBP", category: "marketing" },
  conversation: {
    id: "conv-1",
    origin: { type: "marketing" },
    expiration_timestamp: "1700086400",
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HandleMessageStatusUpdateUseCase", () => {
  it("normaliza e loga uma atualização de status", () => {
    const logger = fakeLogger();
    new HandleMessageStatusUpdateUseCase(logger).execute(BASE);

    expect(logger.info).toHaveBeenCalledWith(
      "Atualização de status de mensagem recebida",
      expect.objectContaining({ messageId: "wamid.1", status: "sent" }),
    );
  });

  it("registra um evento de consumo quando há pricing/conversation", () => {
    const recorder = recordingRecorder();
    new HandleMessageStatusUpdateUseCase(fakeLogger(), recorder).execute(WITH_PRICING);

    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0]).toMatchObject({
      conversationId: "conv-1",
      recipientId: "5511999999999",
      category: "marketing",
      originType: "marketing",
      pricingModel: "CBP",
      billable: true,
    });
    expect(recorder.calls[0]!.occurredAt).toEqual(new Date(1700000000 * 1000));
    expect(recorder.calls[0]!.expirationTimestamp).toEqual(new Date(1700086400 * 1000));
  });

  it("não registra nada quando faltam pricing/conversation", () => {
    const recorder = recordingRecorder();
    new HandleMessageStatusUpdateUseCase(fakeLogger(), recorder).execute(BASE);

    expect(recorder.calls).toHaveLength(0);
  });

  it("não registra quando conversation.id está ausente", () => {
    const recorder = recordingRecorder();
    new HandleMessageStatusUpdateUseCase(fakeLogger(), recorder).execute({
      ...BASE,
      pricing: { billable: true, category: "utility" },
      conversation: { origin: { type: "utility" } },
    });

    expect(recorder.calls).toHaveLength(0);
  });

  it("uma falha do recorder não impede o log nem lança", () => {
    const logger = fakeLogger();
    const failing: MessagingCostRecorderPort = {
      recordConversationEvent: () => Promise.reject(new Error("boom")),
    };

    expect(() =>
      new HandleMessageStatusUpdateUseCase(logger, failing).execute(WITH_PRICING),
    ).not.toThrow();
    expect(logger.info).toHaveBeenCalled();
  });

  it("sem recorder injetado (default no-op) o comportamento é idêntico ao atual: só log", () => {
    const logger = fakeLogger();
    expect(() =>
      new HandleMessageStatusUpdateUseCase(logger).execute(WITH_PRICING),
    ).not.toThrow();
    expect(logger.info).toHaveBeenCalledTimes(1);
  });
});
