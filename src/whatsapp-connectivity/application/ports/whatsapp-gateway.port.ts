import type { OutboundMessage } from "../../domain/outbound-message.ts";
import type { OutboundTextMessage } from "../../domain/outbound-text-message.ts";

export interface SentMessage {
  wamid: string;
}

export interface WhatsAppGatewayPort {
  sendTemplateMessage(message: OutboundMessage): Promise<SentMessage>;
  sendTextMessage(message: OutboundTextMessage): Promise<SentMessage>;
}
