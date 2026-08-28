import type { Logger } from "../../application/ports/logger.port.ts";
import type { ReplySenderPort } from "../../application/ports/reply-sender.port.ts";

/** Contrato mínimo do `SendTextMessageUseCase` de `whatsapp-connectivity`. */
export interface TextMessageSender {
  execute(input: { to: string; body: string }): Promise<unknown>;
}

export interface ReplySenderAdapterDeps {
  sendTextMessage: TextMessageSender;
  logger: Logger;
  /** Espera antes da tentativa adicional de envio. */
  retryDelayMs?: number;
}

const sleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

/**
 * Implementa `ReplySenderPort` embrulhando o envio de texto do slice
 * `whatsapp-connectivity`. Faz uma tentativa adicional por mensagem; se ainda
 * assim falhar, registra o erro e NÃO lança (o lote segue).
 */
export class ReplySenderAdapter implements ReplySenderPort {
  private readonly sendTextMessage: TextMessageSender;
  private readonly logger: Logger;
  private readonly retryDelayMs: number;

  constructor(deps: ReplySenderAdapterDeps) {
    this.sendTextMessage = deps.sendTextMessage;
    this.logger = deps.logger;
    this.retryDelayMs = deps.retryDelayMs ?? 500;
  }

  async send(to: string, body: string): Promise<void> {
    try {
      await this.sendTextMessage.execute({ to, body });
      return;
    } catch {
      await sleep(this.retryDelayMs);
    }

    try {
      await this.sendTextMessage.execute({ to, body });
    } catch (error) {
      this.logger.error("Falha ao enviar mensagem de resposta ao lead após a tentativa adicional", {
        to,
        error: error instanceof Error ? error.message : String(error),
        ...(isWithCode(error) && error.code !== undefined ? { code: error.code } : {}),
      });
    }
  }
}

function isWithCode(error: unknown): error is { code?: string } {
  return typeof error === "object" && error !== null && "code" in error;
}
