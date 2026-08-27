import {
  OutboundTextMessage,
  type OutboundTextMessageInput,
} from "../../domain/outbound-text-message.ts";
import type { SentMessage, WhatsAppGatewayPort } from "../ports/whatsapp-gateway.port.ts";

export class SendTextMessageUseCase {
  constructor(private readonly gateway: WhatsAppGatewayPort) {}

  async execute(input: OutboundTextMessageInput): Promise<SentMessage> {
    const message = OutboundTextMessage.create(input);
    return this.gateway.sendTextMessage(message);
  }
}
