import { afterEach, describe, expect, it, vi } from "vitest";
import { WhatsAppApiError } from "../../application/errors.ts";
import { OutboundTextMessage } from "../../domain/outbound-text-message.ts";
import { MetaCloudApiGateway } from "./meta-cloud-api.gateway.ts";

const config = { accessToken: "token-123", phoneNumberId: "phone-123" };

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MetaCloudApiGateway.sendTextMessage", () => {
  const message = OutboundTextMessage.create({ to: "+5511999999999", body: "Olá, tudo bem?" });

  it("envia POST para o endpoint de mensagens com corpo type:text e retorna o wamid", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ messages: [{ id: "wamid.abc" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new MetaCloudApiGateway(config).sendTextMessage(message);

    expect(result).toEqual({ wamid: "wamid.abc" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v21.0/phone-123/messages");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: "whatsapp",
      to: "+5511999999999",
      type: "text",
      text: { body: "Olá, tudo bem?" },
    });
  });

  it("propaga WhatsAppApiError quando a Cloud API responde com status não-ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          { error: { message: "Message failed to send", code: 131047 } },
          { status: 400 },
        ),
      ),
    );

    await expect(new MetaCloudApiGateway(config).sendTextMessage(message)).rejects.toMatchObject({
      name: "WhatsAppApiError",
      message: "Message failed to send",
      code: "131047",
    });
  });

  it("propaga WhatsAppApiError com cause quando o fetch falha por erro de rede", async () => {
    const networkError = new Error("network down");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(networkError));

    const error = await new MetaCloudApiGateway(config)
      .sendTextMessage(message)
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(WhatsAppApiError);
    expect((error as WhatsAppApiError).cause).toBe(networkError);
  });

  it("propaga WhatsAppApiError quando a resposta não contém wamid", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ messages: [] })));

    await expect(new MetaCloudApiGateway(config).sendTextMessage(message)).rejects.toBeInstanceOf(
      WhatsAppApiError,
    );
  });
});
