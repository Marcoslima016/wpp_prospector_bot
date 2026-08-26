import { z } from "zod";
import { DomainValidationError } from "./errors.ts";

const E164_REGEX = /^\+[1-9]\d{1,14}$/;

const outboundMessageSchema = z.object({
  to: z
    .string()
    .regex(E164_REGEX, "Número de telefone deve estar no formato E.164 (ex.: +5511999999999)"),
  templateName: z.string().min(1, "Nome do template é obrigatório"),
  languageCode: z.string().min(1, "Idioma do template é obrigatório"),
  parameters: z.array(z.string()).default([]),
});

export type OutboundMessageInput = z.input<typeof outboundMessageSchema>;

export class OutboundMessage {
  readonly to: string;
  readonly templateName: string;
  readonly languageCode: string;
  readonly parameters: readonly string[];

  private constructor(props: z.infer<typeof outboundMessageSchema>) {
    this.to = props.to;
    this.templateName = props.templateName;
    this.languageCode = props.languageCode;
    this.parameters = props.parameters;
  }

  static create(input: OutboundMessageInput): OutboundMessage {
    const result = outboundMessageSchema.safeParse(input);

    if (!result.success) {
      throw new DomainValidationError("OutboundMessage inválida", result.error.issues);
    }

    return new OutboundMessage(result.data);
  }
}
