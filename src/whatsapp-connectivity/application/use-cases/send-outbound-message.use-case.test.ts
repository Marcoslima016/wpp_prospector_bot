import { describe, expect, it } from "vitest";
import { DomainValidationError } from "../../domain/errors.ts";
import type { OutboundMessage } from "../../domain/outbound-message.ts";
import { WhatsAppApiError } from "../errors.ts";
import type { SentMessage, WhatsAppGatewayPort } from "../ports/whatsapp-gateway.port.ts";
import { SendOutboundMessageUseCase } from "./send-outbound-message.use-case.ts";

class FakeWhatsAppGateway implements WhatsAppGatewayPort {
  lastMessage: OutboundMessage | undefined;

  constructor(private readonly result: SentMessage | Error) {}

  async sendTemplateMessage(message: OutboundMessage): Promise<SentMessage> {
    this.lastMessage = message;

    if (this.result instanceof Error) {
      throw this.result;
    }

    return this.result;
  }
}

describe("SendOutboundMessageUseCase", () => {
  it("envia a mensagem de template e retorna o wamid atribuído pela Cloud API", async () => {
    const gateway = new FakeWhatsAppGateway({ wamid: "wamid.123" });
    const useCase = new SendOutboundMessageUseCase(gateway);

    const result = await useCase.execute({
      to: "+5511999999999",
      templateName: "hello_world",
      languageCode: "en_US",
      parameters: [],
    });

    expect(result).toEqual({ wamid: "wamid.123" });
    expect(gateway.lastMessage?.to).toBe("+5511999999999");
    expect(gateway.lastMessage?.templateName).toBe("hello_world");
  });

  it("propaga o erro identificável retornado pelo gateway quando a Cloud API rejeita o envio", async () => {
    const gateway = new FakeWhatsAppGateway(
      new WhatsAppApiError("Template não aprovado", { code: "132001" }),
    );
    const useCase = new SendOutboundMessageUseCase(gateway);

    await expect(
      useCase.execute({
        to: "+5511999999999",
        templateName: "hello_world",
        languageCode: "en_US",
      }),
    ).rejects.toBeInstanceOf(WhatsAppApiError);
  });

  it("rejeita entrada inválida com um erro de domínio identificável, sem chamar o gateway", async () => {
    const gateway = new FakeWhatsAppGateway({ wamid: "wamid.123" });
    const useCase = new SendOutboundMessageUseCase(gateway);

    await expect(
      useCase.execute({
        to: "11999999999",
        templateName: "hello_world",
        languageCode: "en_US",
      }),
    ).rejects.toBeInstanceOf(DomainValidationError);
    expect(gateway.lastMessage).toBeUndefined();
  });
});
