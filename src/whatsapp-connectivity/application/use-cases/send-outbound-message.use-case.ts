import { OutboundMessage, type OutboundMessageInput } from "../../domain/outbound-message.ts";
import type { SentMessage, WhatsAppGatewayPort } from "../ports/whatsapp-gateway.port.ts";

export class SendOutboundMessageUseCase {
  constructor(private readonly gateway: WhatsAppGatewayPort) {}

  async execute(input: OutboundMessageInput): Promise<SentMessage> {
    const message = OutboundMessage.create(input);
    return this.gateway.sendTemplateMessage(message);
  }
}
