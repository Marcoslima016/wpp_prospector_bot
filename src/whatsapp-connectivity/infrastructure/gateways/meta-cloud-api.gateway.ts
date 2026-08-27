import { WhatsAppApiError } from "../../application/errors.ts";
import type {
  SentMessage,
  WhatsAppGatewayPort,
} from "../../application/ports/whatsapp-gateway.port.ts";
import type { OutboundMessage } from "../../domain/outbound-message.ts";
import type { OutboundTextMessage } from "../../domain/outbound-text-message.ts";

const GRAPH_API_VERSION = "v21.0";

export interface MetaCloudApiGatewayConfig {
  accessToken: string;
  phoneNumberId: string;
}

interface GraphApiSendMessageResponse {
  messages?: Array<{ id: string }>;
}

interface GraphApiErrorResponse {
  error?: {
    message?: string;
    code?: number;
  };
}

export class MetaCloudApiGateway implements WhatsAppGatewayPort {
  constructor(private readonly config: MetaCloudApiGatewayConfig) {}

  async sendTemplateMessage(message: OutboundMessage): Promise<SentMessage> {
    const response = await this.postMessage({
      messaging_product: "whatsapp",
      to: message.to,
      type: "template",
      template: {
        name: message.templateName,
        language: { code: message.languageCode },
        ...(message.parameters.length > 0
          ? {
              components: [
                {
                  type: "body",
                  parameters: message.parameters.map((text) => ({ type: "text", text })),
                },
              ],
            }
          : {}),
      },
    });

    return this.parseSendMessageResponse(response);
  }

  async sendTextMessage(message: OutboundTextMessage): Promise<SentMessage> {
    const response = await this.postMessage({
      messaging_product: "whatsapp",
      to: message.to,
      type: "text",
      text: { body: message.body },
    });

    return this.parseSendMessageResponse(response);
  }

  private async postMessage(body: unknown): Promise<Response> {
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${this.config.phoneNumberId}/messages`;

    try {
      return await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw new WhatsAppApiError("Falha de rede ao chamar a WhatsApp Cloud API", { cause });
    }
  }

  private async parseSendMessageResponse(response: Response): Promise<SentMessage> {
    const body: unknown = await response.json().catch(() => undefined);

    if (!response.ok) {
      const errorBody = body as GraphApiErrorResponse | undefined;
      throw new WhatsAppApiError(
        errorBody?.error?.message ?? `WhatsApp Cloud API retornou status ${response.status}`,
        {
          code: errorBody?.error?.code !== undefined ? String(errorBody.error.code) : undefined,
          cause: errorBody?.error,
        },
      );
    }

    const wamid = (body as GraphApiSendMessageResponse | undefined)?.messages?.[0]?.id;

    if (!wamid) {
      throw new WhatsAppApiError(
        "WhatsApp Cloud API não retornou um identificador de mensagem (wamid)",
      );
    }

    return { wamid };
  }
}
