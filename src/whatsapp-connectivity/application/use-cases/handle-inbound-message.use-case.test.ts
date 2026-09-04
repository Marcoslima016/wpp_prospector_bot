import { describe, expect, it, vi } from "vitest";
import type { InboundMessagePort } from "../ports/inbound-message.port.ts";
import type { Logger } from "../ports/logger.port.ts";
import { HandleInboundMessageUseCase } from "./handle-inbound-message.use-case.ts";

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function fakePort(): InboundMessagePort {
  return { receive: vi.fn() };
}

describe("HandleInboundMessageUseCase", () => {
  it("normaliza, loga e encaminha ao port de processamento uma mensagem de texto recebida", () => {
    const logger = fakeLogger();
    const port = fakePort();
    const useCase = new HandleInboundMessageUseCase(logger, port);

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
    expect(port.receive).toHaveBeenCalledWith({
      from: "5511999999999",
      messageId: "wamid.1",
      text: "olá",
      timestamp: new Date(1700000000 * 1000),
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("normaliza, loga e encaminha ao port de processamento um toque em botão de template", () => {
    const logger = fakeLogger();
    const port = fakePort();
    const useCase = new HandleInboundMessageUseCase(logger, port);

    useCase.execute({
      from: "5511999999999",
      id: "wamid.button",
      timestamp: "1700000000",
      type: "button",
      button: { text: "Tenho interesse em saber mais", payload: "INTERESSE" },
    });

    expect(logger.info).toHaveBeenCalledWith(
      "Mensagem inbound recebida",
      expect.objectContaining({
        from: "5511999999999",
        messageId: "wamid.button",
        text: "Tenho interesse em saber mais",
      }),
    );
    expect(port.receive).toHaveBeenCalledWith({
      from: "5511999999999",
      messageId: "wamid.button",
      text: "Tenho interesse em saber mais",
      timestamp: new Date(1700000000 * 1000),
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("loga e ignora, sem lançar nem encaminhar, uma mensagem do tipo button sem o campo button", () => {
    const logger = fakeLogger();
    const port = fakePort();
    const useCase = new HandleInboundMessageUseCase(logger, port);

    expect(() =>
      useCase.execute({
        from: "5511999999999",
        id: "wamid.button-sem-payload",
        timestamp: "1700000000",
        type: "button",
      }),
    ).not.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(
      "Mensagem inbound de tipo não suportado ignorada",
      expect.objectContaining({ messageId: "wamid.button-sem-payload", type: "button" }),
    );
    expect(logger.info).not.toHaveBeenCalled();
    expect(port.receive).not.toHaveBeenCalled();
  });

  it("loga e ignora, sem lançar nem encaminhar, uma mensagem de um tipo ainda não suportado (ex.: imagem)", () => {
    const logger = fakeLogger();
    const port = fakePort();
    const useCase = new HandleInboundMessageUseCase(logger, port);

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
    expect(port.receive).not.toHaveBeenCalled();
  });

  it("registra o erro e não quebra quando o port de processamento lança", () => {
    const logger = fakeLogger();
    const port: InboundMessagePort = {
      receive: vi.fn(() => {
        throw new Error("downstream indisponível");
      }),
    };
    const useCase = new HandleInboundMessageUseCase(logger, port);

    expect(() =>
      useCase.execute({
        from: "5511999999999",
        id: "wamid.3",
        timestamp: "1700000000",
        type: "text",
        text: { body: "oi" },
      }),
    ).not.toThrow();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("encaminhar mensagem inbound"),
      expect.objectContaining({ messageId: "wamid.3" }),
    );
  });
});
