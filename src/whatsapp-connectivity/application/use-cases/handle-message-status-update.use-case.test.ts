import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../ports/logger.port.ts";
import { HandleMessageStatusUpdateUseCase } from "./handle-message-status-update.use-case.ts";

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("HandleMessageStatusUpdateUseCase", () => {
  it("normaliza e loga uma atualização de status", () => {
    const logger = fakeLogger();
    const useCase = new HandleMessageStatusUpdateUseCase(logger);

    useCase.execute({
      id: "wamid.1",
      status: "delivered",
      timestamp: "1700000000",
      recipient_id: "5511999999999",
    });

    expect(logger.info).toHaveBeenCalledWith(
      "Atualização de status de mensagem recebida",
      expect.objectContaining({ messageId: "wamid.1", status: "delivered" }),
    );
  });
});
