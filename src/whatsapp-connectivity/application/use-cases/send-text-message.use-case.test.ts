import { describe, expect, it } from "vitest";
import { DomainValidationError } from "../../domain/errors.ts";
import type { OutboundMessage } from "../../domain/outbound-message.ts";
import type { OutboundTextMessage } from "../../domain/outbound-text-message.ts";
import { WhatsAppApiError } from "../errors.ts";
import type { SentMessage, WhatsAppGatewayPort } from "../ports/whatsapp-gateway.port.ts";
import { SendTextMessageUseCase } from "./send-text-message.use-case.ts";

class FakeWhatsAppGateway implements WhatsAppGatewayPort {
  lastTextMessage: OutboundTextMessage | undefined;

  constructor(private readonly result: SentMessage | Error) {}

  async sendTemplateMessage(_message: OutboundMessage): Promise<SentMessage> {
    throw new Error("não usado neste teste");
  }

  async sendTextMessage(message: OutboundTextMessage): Promise<SentMessage> {
    this.lastTextMessage = message;

    if (this.result instanceof Error) {
      throw this.result;
    }

    return this.result;
  }
}

describe("SendTextMessageUseCase", () => {
  it("envia a mensagem de texto e retorna o wamid atribuído pela Cloud API", async () => {
    const gateway = new FakeWhatsAppGateway({ wamid: "wamid.123" });
    const useCase = new SendTextMessageUseCase(gateway);

    const result = await useCase.execute({
      to: "+5511999999999",
      body: "Olá, tudo bem?",
    });

    expect(result).toEqual({ wamid: "wamid.123" });
    expect(gateway.lastTextMessage?.to).toBe("+5511999999999");
    expect(gateway.lastTextMessage?.body).toBe("Olá, tudo bem?");
  });

  it("propaga o erro identificável retornado pelo gateway quando a Cloud API rejeita o envio", async () => {
    const gateway = new FakeWhatsAppGateway(
      new WhatsAppApiError("Janela de atendimento fechada", { code: "131047" }),
    );
    const useCase = new SendTextMessageUseCase(gateway);

    await expect(
      useCase.execute({ to: "+5511999999999", body: "Olá" }),
    ).rejects.toBeInstanceOf(WhatsAppApiError);
  });

  it("rejeita entrada inválida com um erro de domínio identificável, sem chamar o gateway", async () => {
    const gateway = new FakeWhatsAppGateway({ wamid: "wamid.123" });
    const useCase = new SendTextMessageUseCase(gateway);

    await expect(
      useCase.execute({ to: "+5511999999999", body: "" }),
    ).rejects.toBeInstanceOf(DomainValidationError);
    expect(gateway.lastTextMessage).toBeUndefined();
  });
});
