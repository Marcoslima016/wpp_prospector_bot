import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../../application/ports/logger.port.ts";
import { ReplySenderAdapter, type TextMessageSender } from "./reply-sender.adapter.ts";

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("ReplySenderAdapter", () => {
  it("envia a mensagem com sucesso na primeira tentativa", async () => {
    const execute = vi.fn().mockResolvedValue({ wamid: "wamid.1" });
    const logger = fakeLogger();
    const adapter = new ReplySenderAdapter({
      sendTextMessage: { execute } as TextMessageSender,
      logger,
      retryDelayMs: 0,
    });

    await adapter.send("+5511999999999", "olá");

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({ to: "+5511999999999", body: "olá" });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("recupera na tentativa adicional após uma falha transitória", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({ wamid: "wamid.2" });
    const logger = fakeLogger();
    const adapter = new ReplySenderAdapter({
      sendTextMessage: { execute } as TextMessageSender,
      logger,
      retryDelayMs: 0,
    });

    await adapter.send("+5511999999999", "olá");

    expect(execute).toHaveBeenCalledTimes(2);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("registra o erro sem lançar quando a falha persiste após o retry", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("janela fechada"));
    const logger = fakeLogger();
    const adapter = new ReplySenderAdapter({
      sendTextMessage: { execute } as TextMessageSender,
      logger,
      retryDelayMs: 0,
    });

    await expect(adapter.send("+5511999999999", "olá")).resolves.toBeUndefined();

    expect(execute).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Falha ao enviar"),
      expect.objectContaining({ to: "+5511999999999" }),
    );
  });
});
