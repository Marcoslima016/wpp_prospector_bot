import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { Logger } from "../../application/ports/logger.port.ts";
import type {
  MessagingCostRecorderPort,
  WhatsappConversationEvent,
} from "../../application/ports/messaging-cost-recorder.port.ts";
import { META_PRICE_TABLE_VERSION } from "../pricing/meta-conversation-prices.ts";

const INSERT_SQL = `
  INSERT INTO whatsapp_conversation_events
    (occurred_at, conversation_id, recipient_id, category, origin_type, pricing_model,
     billable, expiration_timestamp, billing_country, price_version, recorded_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(conversation_id) DO NOTHING
`;

/**
 * Adapter de `MessagingCostRecorderPort` sobre o armazenamento SQL embutido.
 * Grava uma linha append-only por janela de conversa de 24 h, deduplicada por
 * `conversationId` (`ON CONFLICT DO NOTHING` — vários eventos de status da mesma
 * janela não geram linhas extras). Best-effort: `recordConversationEvent` nunca
 * rejeita nem lança — uma falha de escrita é logada e o evento é descartado.
 */
export class SqliteMessagingCostRecorder implements MessagingCostRecorderPort {
  private readonly insert: StatementSync;

  constructor(
    db: DatabaseSync,
    private readonly logger: Logger,
    /** País-base assumido para a estimativa de custo (`WHATSAPP_BILLING_COUNTRY`). */
    private readonly billingCountry: string,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.insert = db.prepare(INSERT_SQL);
  }

  recordConversationEvent(event: WhatsappConversationEvent): Promise<void> {
    try {
      this.insert.run(
        event.occurredAt.toISOString(),
        event.conversationId,
        event.recipientId,
        event.category,
        event.originType,
        event.pricingModel,
        event.billable ? 1 : 0,
        event.expirationTimestamp?.toISOString() ?? null,
        this.billingCountry,
        META_PRICE_TABLE_VERSION,
        this.clock().toISOString(),
      );
    } catch (error) {
      this.logger.warn("Falha ao registrar consumo de mensageria — evento descartado", {
        conversationId: event.conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return Promise.resolve();
  }
}
