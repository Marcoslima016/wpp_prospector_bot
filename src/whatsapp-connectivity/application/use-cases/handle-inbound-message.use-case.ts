import { InboundMessage } from "../../domain/inbound-message.ts";
import type { InboundMessagePort } from "../ports/inbound-message.port.ts";
import type { Logger } from "../ports/logger.port.ts";

export interface RawInboundMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
}

export class HandleInboundMessageUseCase {
  constructor(
    private readonly logger: Logger,
    private readonly inboundMessagePort: InboundMessagePort,
  ) {}

  execute(raw: RawInboundMessage): void {
    if (raw.type !== "text" || !raw.text) {
      this.logger.warn("Mensagem inbound de tipo não suportado ignorada", {
        messageId: raw.id,
        type: raw.type,
      });
      return;
    }

    const message = InboundMessage.create({
      from: raw.from,
      messageId: raw.id,
      text: raw.text.body,
      timestamp: new Date(Number(raw.timestamp) * 1000),
    });

    this.logger.info("Mensagem inbound recebida", {
      from: message.from,
      messageId: message.messageId,
      text: message.text,
      timestamp: message.timestamp.toISOString(),
    });

    try {
      this.inboundMessagePort.receive({
        from: message.from,
        messageId: message.messageId,
        text: message.text,
        timestamp: message.timestamp,
      });
    } catch (error) {
      this.logger.error("Falha ao encaminhar mensagem inbound ao processador downstream", {
        messageId: message.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
