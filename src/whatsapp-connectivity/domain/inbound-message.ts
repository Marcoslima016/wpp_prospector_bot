import { z } from "zod";
import { DomainValidationError } from "./errors.ts";

const inboundMessageSchema = z.object({
  from: z.string().min(1, "Remetente é obrigatório"),
  messageId: z.string().min(1, "Identificador da mensagem é obrigatório"),
  text: z.string().min(1, "Texto da mensagem é obrigatório"),
  timestamp: z.date(),
});

export type InboundMessageInput = z.input<typeof inboundMessageSchema>;

export class InboundMessage {
  readonly from: string;
  readonly messageId: string;
  readonly text: string;
  readonly timestamp: Date;

  private constructor(props: z.infer<typeof inboundMessageSchema>) {
    this.from = props.from;
    this.messageId = props.messageId;
    this.text = props.text;
    this.timestamp = props.timestamp;
  }

  static create(input: InboundMessageInput): InboundMessage {
    const result = inboundMessageSchema.safeParse(input);

    if (!result.success) {
      throw new DomainValidationError("InboundMessage inválida", result.error.issues);
    }

    return new InboundMessage(result.data);
  }
}
