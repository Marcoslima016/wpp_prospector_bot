import { MessageStatusUpdate, type MessageStatus } from "../../domain/message-status-update.ts";
import type { Logger } from "../ports/logger.port.ts";

export interface RawMessageStatusUpdate {
  id: string;
  status: MessageStatus;
  timestamp: string;
  recipient_id: string;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
}

export class HandleMessageStatusUpdateUseCase {
  constructor(private readonly logger: Logger) {}

  execute(raw: RawMessageStatusUpdate): void {
    const statusUpdate = MessageStatusUpdate.create({
      messageId: raw.id,
      status: raw.status,
    });

    this.logger.info("Atualização de status de mensagem recebida", {
      messageId: statusUpdate.messageId,
      status: statusUpdate.status,
      recipientId: raw.recipient_id,
      timestamp: new Date(Number(raw.timestamp) * 1000).toISOString(),
      ...(raw.errors ? { errors: raw.errors } : {}),
    });
  }
}
