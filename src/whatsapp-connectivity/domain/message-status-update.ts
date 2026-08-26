import { z } from "zod";
import { DomainValidationError } from "./errors.ts";

const messageStatusSchema = z.enum(["sent", "delivered", "read", "failed"]);

export type MessageStatus = z.infer<typeof messageStatusSchema>;

const messageStatusUpdateSchema = z.object({
  messageId: z.string().min(1, "Identificador da mensagem é obrigatório"),
  status: messageStatusSchema,
});

export type MessageStatusUpdateInput = z.input<typeof messageStatusUpdateSchema>;

export class MessageStatusUpdate {
  readonly messageId: string;
  readonly status: MessageStatus;

  private constructor(props: z.infer<typeof messageStatusUpdateSchema>) {
    this.messageId = props.messageId;
    this.status = props.status;
  }

  static create(input: MessageStatusUpdateInput): MessageStatusUpdate {
    const result = messageStatusUpdateSchema.safeParse(input);

    if (!result.success) {
      throw new DomainValidationError("MessageStatusUpdate inválida", result.error.issues);
    }

    return new MessageStatusUpdate(result.data);
  }
}
