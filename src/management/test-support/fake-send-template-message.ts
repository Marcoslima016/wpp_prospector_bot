import type { SendOutboundMessageUseCase } from "../../whatsapp-connectivity/application/use-cases/send-outbound-message.use-case.ts";
import type { OutboundMessageInput } from "../../whatsapp-connectivity/domain/outbound-message.ts";
import type { SentMessage } from "../../whatsapp-connectivity/application/ports/whatsapp-gateway.port.ts";

/**
 * Fake do `SendOutboundMessageUseCase` (envio de template) para os testes da API
 * de gestão. Registra as chamadas e, por padrão, resolve com um `wamid` fixo.
 * `failWith` força as chamadas seguintes a rejeitarem — simula a recusa do gateway.
 */
export class FakeSendTemplateMessageUseCase {
  readonly calls: OutboundMessageInput[] = [];
  private error: Error | undefined;

  failWith(error: Error): void {
    this.error = error;
  }

  execute(input: OutboundMessageInput): Promise<SentMessage> {
    this.calls.push(input);
    if (this.error) {
      return Promise.reject(this.error);
    }
    return Promise.resolve({ wamid: `wamid.tmpl.${this.calls.length}` });
  }

  /** Visão do fake com o tipo do caso de uso real, para injeção. */
  asUseCase(): SendOutboundMessageUseCase {
    return this as unknown as SendOutboundMessageUseCase;
  }
}
