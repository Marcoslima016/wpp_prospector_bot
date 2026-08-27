import { z } from "zod";
import { DomainValidationError } from "./errors.ts";
import { E164_REGEX } from "./outbound-message.ts";

const outboundTextMessageSchema = z.object({
  to: z
    .string()
    .regex(E164_REGEX, "Número de telefone deve estar no formato E.164 (ex.: +5511999999999)"),
  body: z
    .string()
    .min(1, "Corpo da mensagem não pode ser vazio")
    .max(4096, "Corpo da mensagem excede o limite de 4096 caracteres da Cloud API"),
});

export type OutboundTextMessageInput = z.input<typeof outboundTextMessageSchema>;

export class OutboundTextMessage {
  readonly to: string;
  readonly body: string;

  private constructor(props: z.infer<typeof outboundTextMessageSchema>) {
    this.to = props.to;
    this.body = props.body;
  }

  static create(input: OutboundTextMessageInput): OutboundTextMessage {
    const result = outboundTextMessageSchema.safeParse(input);

    if (!result.success) {
      throw new DomainValidationError("OutboundTextMessage inválida", result.error.issues);
    }

    return new OutboundTextMessage(result.data);
  }
}
