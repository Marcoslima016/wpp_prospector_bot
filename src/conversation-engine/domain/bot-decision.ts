import { z } from "zod";
import { DomainValidationError } from "./errors.ts";
import { LEAD_INTENTS, type LeadIntent } from "./lead-intent.ts";
import { LEAD_QUALIFICATIONS, type LeadQualification } from "./lead-qualification.ts";

const botDecisionSchema = z.object({
  replyMessages: z.array(z.string().min(1, "Mensagem de resposta não pode ser vazia")),
  endConversation: z.boolean(),
  leadIntent: z.enum(LEAD_INTENTS),
  leadQualification: z.enum(LEAD_QUALIFICATIONS).nullable(),
  handoffToHuman: z.boolean(),
  reasoning: z.string().nullable(),
});

export type BotDecisionInput = z.input<typeof botDecisionSchema>;

/**
 * JSON Schema equivalente ao `botDecisionSchema`, usado como `responseSchema`
 * da chamada estruturada ao LLM (`output_config.format`). Mantido em sincronia
 * manual com o schema zod acima — a validação real da saída é feita por
 * `BotDecision.create`.
 */
export const BOT_DECISION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    replyMessages: {
      type: "array",
      items: { type: "string", minLength: 1 },
      description:
        "Mensagens de resposta na ordem de envio. Lista vazia significa não responder. " +
        "Use uma única mensagem quando o lead trata de um só assunto; use várias apenas " +
        "quando pontos distintos exigem respostas separadas.",
    },
    endConversation: {
      type: "boolean",
      description: "true quando a conversa deve ser encerrada após este turno.",
    },
    leadIntent: {
      type: "string",
      enum: [...LEAD_INTENTS],
      description: "Intenção identificada do lead nas mensagens interpretadas.",
    },
    leadQualification: {
      type: ["string", "null"],
      enum: [...LEAD_QUALIFICATIONS, null],
      description: "Qualificação comercial do lead, ou null quando ainda não é possível qualificar.",
    },
    handoffToHuman: {
      type: "boolean",
      description: "true quando a conversa deve ser transferida para atendimento humano.",
    },
    reasoning: {
      type: ["string", "null"],
      description: "Justificativa interna da decisão. NUNCA é enviada ao lead.",
    },
  },
  required: [
    "replyMessages",
    "endConversation",
    "leadIntent",
    "leadQualification",
    "handoffToHuman",
    "reasoning",
  ],
} as const;

export class BotDecision {
  readonly replyMessages: readonly string[];
  readonly endConversation: boolean;
  readonly leadIntent: LeadIntent;
  readonly leadQualification: LeadQualification | null;
  readonly handoffToHuman: boolean;
  readonly reasoning: string | null;

  private constructor(props: z.infer<typeof botDecisionSchema>) {
    this.replyMessages = props.replyMessages;
    this.endConversation = props.endConversation;
    this.leadIntent = props.leadIntent;
    this.leadQualification = props.leadQualification;
    this.handoffToHuman = props.handoffToHuman;
    this.reasoning = props.reasoning;
  }

  get shouldReply(): boolean {
    return this.replyMessages.length > 0;
  }

  static create(input: BotDecisionInput): BotDecision {
    const result = botDecisionSchema.safeParse(input);

    if (!result.success) {
      throw new DomainValidationError("BotDecision inválida", result.error.issues);
    }

    return new BotDecision(result.data);
  }
}
