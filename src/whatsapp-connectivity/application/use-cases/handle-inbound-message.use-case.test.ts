import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../ports/logger.port.ts";
import { HandleInboundMessageUseCase } from "./handle-inbound-message.use-case.ts";

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("HandleInboundMessageUseCase", () => {
  it("normaliza e loga uma mensagem de texto recebida", () => {
    const logger = fakeLogger();
    const useCase = new HandleInboundMessageUseCase(logger);

    useCase.execute({
      from: "5511999999999",
      id: "wamid.1",
      timestamp: "1700000000",
      type: "text",
      text: { body: "olá" },
    });

    expect(logger.info).toHaveBeenCalledWith(
      "Mensagem inbound recebida",
      expect.objectContaining({
        from: "5511999999999",
        messageId: "wamid.1",
        text: "olá",
      }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("loga e ignora, sem lançar, uma mensagem de tipo ainda não suportado", () => {
    const logger = fakeLogger();
    const useCase = new HandleInboundMessageUseCase(logger);

    expect(() =>
      useCase.execute({
        from: "5511999999999",
        id: "wamid.2",
        timestamp: "1700000000",
        type: "image",
      }),
    ).not.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(
      "Mensagem inbound de tipo não suportado ignorada",
      expect.objectContaining({ messageId: "wamid.2", type: "image" }),
    );
    expect(logger.info).not.toHaveBeenCalled();
  });
});
