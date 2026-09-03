import { MessageStatusUpdate, type MessageStatus } from "../../domain/message-status-update.ts";
import { WhatsappConversationBilling } from "../../domain/whatsapp-conversation-billing.ts";
import type { Logger } from "../ports/logger.port.ts";
import type { MessagingCostRecorderPort } from "../ports/messaging-cost-recorder.port.ts";

/** Default no-op: sem recorder injetado, o registro de consumo simplesmente não acontece. */
const NOOP_COST_RECORDER: MessagingCostRecorderPort = {
  recordConversationEvent: () => Promise.resolve(),
};

export interface RawMessageStatusUpdate {
  id: string;
  status: MessageStatus;
  timestamp: string;
  recipient_id: string;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
  pricing?: {
    billable?: boolean;
    pricing_model?: string;
    category?: string;
  };
  conversation?: {
    id?: string;
    origin?: { type?: string };
    expiration_timestamp?: string;
  };
}

export class HandleMessageStatusUpdateUseCase {
  constructor(
    private readonly logger: Logger,
    private readonly costRecorder: MessagingCostRecorderPort = NOOP_COST_RECORDER,
  ) {}

  execute(raw: RawMessageStatusUpdate): void {
    const statusUpdate = MessageStatusUpdate.create({
      messageId: raw.id,
      status: raw.status,
    });

    const occurredAt = new Date(Number(raw.timestamp) * 1000);

    this.logger.info("Atualização de status de mensagem recebida", {
      messageId: statusUpdate.messageId,
      status: statusUpdate.status,
      recipientId: raw.recipient_id,
      timestamp: occurredAt.toISOString(),
      ...(raw.errors ? { errors: raw.errors } : {}),
    });

    // Registro de consumo de mensageria: best-effort e fora do caminho crítico.
    // Sem `pricing`/`conversation` utilizáveis (`fromWebhook` → null), nada a fazer.
    const billing = WhatsappConversationBilling.fromWebhook(raw.pricing, raw.conversation);
    if (billing) {
      void this.costRecorder
        .recordConversationEvent({
          occurredAt,
          conversationId: billing.conversationId,
          recipientId: raw.recipient_id,
          category: billing.category,
          originType: billing.originType,
          pricingModel: billing.pricingModel,
          billable: billing.billable,
          expirationTimestamp: billing.expirationTimestamp,
        })
        .catch(() => {});
    }
  }
}
