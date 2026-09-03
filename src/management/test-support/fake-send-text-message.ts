import type { SendTextMessageUseCase } from "../../whatsapp-connectivity/application/use-cases/send-text-message.use-case.ts";
import type { OutboundTextMessageInput } from "../../whatsapp-connectivity/domain/outbound-text-message.ts";
import type { SentMessage } from "../../whatsapp-connectivity/application/ports/whatsapp-gateway.port.ts";

/**
 * Fake do `SendTextMessageUseCase` para os testes da API de gestão. Registra as
 * chamadas e, por padrão, resolve com um `wamid` fixo. `failWith` força a próxima
 * (e seguintes) chamadas a rejeitarem — usado para simular a recusa do gateway.
 */
export class FakeSendTextMessageUseCase {
  readonly calls: OutboundTextMessageInput[] = [];
  private error: Error | undefined;

  failWith(error: Error): void {
    this.error = error;
  }

  execute(input: OutboundTextMessageInput): Promise<SentMessage> {
    this.calls.push(input);
    if (this.error) {
      return Promise.reject(this.error);
    }
    return Promise.resolve({ wamid: `wamid.fake.${this.calls.length}` });
  }

  /** Visão do fake com o tipo do caso de uso real, para injeção. */
  asUseCase(): SendTextMessageUseCase {
    return this as unknown as SendTextMessageUseCase;
  }
}
