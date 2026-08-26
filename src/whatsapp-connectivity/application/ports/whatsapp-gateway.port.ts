import type { OutboundMessage } from "../../domain/outbound-message.ts";

export interface SentMessage {
  wamid: string;
}

export interface WhatsAppGatewayPort {
  sendTemplateMessage(message: OutboundMessage): Promise<SentMessage>;
}
