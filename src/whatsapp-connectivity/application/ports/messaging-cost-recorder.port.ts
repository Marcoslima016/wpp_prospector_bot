import type { ConversationCategory } from "../../domain/whatsapp-conversation-billing.ts";

/**
 * Evento de consumo de mensageria: uma janela de conversa de 24 h da WhatsApp
 * Cloud API, deduplicada por `conversationId`. Alimenta a fonte WhatsApp da
 * capability `consumption-metrics`.
 */
export interface WhatsappConversationEvent {
  /** Instante do evento de status que trouxe os dados de precificação (ISO UTC na escrita). */
  occurredAt: Date;
  /** Id da janela de 24 h — chave de deduplicação. */
  conversationId: string;
  /** Telefone do lead (`recipient_id` do evento de status). */
  recipientId: string;
  category: ConversationCategory | "unknown";
  originType: string;
  pricingModel: string;
  billable: boolean;
  expirationTimestamp?: Date;
}

/**
 * Registra janelas de conversa faturáveis. Best-effort: `recordConversationEvent`
 * NÃO rejeita nem lança — uma falha de escrita é logada e o evento é descartado,
 * sem afetar o tratamento do evento de status nem a confirmação 200 ao webhook.
 */
export interface MessagingCostRecorderPort {
  recordConversationEvent(event: WhatsappConversationEvent): Promise<void>;
}
