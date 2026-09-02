import { z } from "zod";
import { DomainValidationError } from "./errors.ts";
import { LEAD_INTENTS, type LeadIntent } from "./lead-intent.ts";
import { LEAD_QUALIFICATIONS, type LeadQualification } from "./lead-qualification.ts";
import {
  COMMERCIAL_PLANS,
  MODULE_IDS,
  type CommercialPlan,
  type ModuleId,
} from "./product-catalog.ts";

const botDecisionSchema = z.object({
  replyMessages: z.array(z.string().min(1, "Mensagem de resposta não pode ser vazia")),
  endConversation: z.boolean(),
  leadIntent: z.enum(LEAD_INTENTS),
  leadQualification: z.enum(LEAD_QUALIFICATIONS).nullable(),
  handoffToHuman: z.boolean(),
  reasoning: z.string().nullable(),
  /** Módulos que o bot ofereceu neste turno. */
  recommendedModules: z.array(z.enum(MODULE_IDS)).default([]),
  /** Módulos em que o lead demonstrou interesse neste turno. */
  interestedModules: z.array(z.enum(MODULE_IDS)).default([]),
  /** Plano cujo preço foi citado neste turno, ou `null`. */
  quotedPlan: z.enum(COMMERCIAL_PLANS).nullable().default(null),
});

export type BotDecisionInput = z.input<typeof botDecisionSchema>;

/**
 * JSON Schema equivalente ao `botDecisionSchema`, usado como `responseSchema`
 * da chamada estruturada ao LLM (`output_config.format`). Mantido em sincronia
 * manual com o schema zod acima — a validação real da saída é feita por
 * `BotDecision.create`.
 *
 * Restrições do subconjunto aceito pela Anthropic em `output_config.format`:
 * sem `type` em array (nullable via `anyOf` + `{ type: "null" }`), sem
 * `minLength`/`maxLength`, `additionalProperties` deve ser `false`, todos os
 * campos em `required`.
 */
export const BOT_DECISION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    replyMessages: {
      type: "array",
      items: { type: "string" },
      description:
        "Mensagens de resposta na ordem de envio. Lista vazia significa não responder. " +
        "Use uma única mensagem quando o lead trata de um só assunto; use várias apenas " +
        "quando pontos distintos exigem respostas separadas. Cada item deve ser não-vazio.",
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
      anyOf: [{ type: "string", enum: [...LEAD_QUALIFICATIONS] }, { type: "null" }],
      description:
        "Qualificação comercial do lead, ou null quando ainda não é possível qualificar.",
    },
    handoffToHuman: {
      type: "boolean",
      description: "true quando a conversa deve ser transferida para atendimento humano.",
    },
    reasoning: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "Justificativa interna da decisão. NUNCA é enviada ao lead.",
    },
    recommendedModules: {
      type: "array",
      items: { type: "string", enum: [...MODULE_IDS] },
      description:
        "Ids dos módulos que o bot ofereceu/apresentou neste turno. Lista vazia " +
        "quando nenhum módulo foi apresentado.",
    },
    interestedModules: {
      type: "array",
      items: { type: "string", enum: [...MODULE_IDS] },
      description:
        "Ids dos módulos em que o lead demonstrou interesse neste turno. Lista " +
        "vazia quando não houve sinal de interesse específico.",
    },
    quotedPlan: {
      anyOf: [{ type: "string", enum: [...COMMERCIAL_PLANS] }, { type: "null" }],
      description:
        "Plano cujo preço foi citado ao lead neste turno (`essencial` ou " +
        "`personalizado`), ou `null` se nenhum preço foi citado.",
    },
  },
  required: [
    "replyMessages",
    "endConversation",
    "leadIntent",
    "leadQualification",
    "handoffToHuman",
    "reasoning",
    "recommendedModules",
    "interestedModules",
    "quotedPlan",
  ],
} as const;

export class BotDecision {
  readonly replyMessages: readonly string[];
  readonly endConversation: boolean;
  readonly leadIntent: LeadIntent;
  readonly leadQualification: LeadQualification | null;
  readonly handoffToHuman: boolean;
  readonly reasoning: string | null;
  readonly recommendedModules: readonly ModuleId[];
  readonly interestedModules: readonly ModuleId[];
  readonly quotedPlan: CommercialPlan | null;

  private constructor(props: z.infer<typeof botDecisionSchema>) {
    this.replyMessages = props.replyMessages;
    this.endConversation = props.endConversation;
    this.leadIntent = props.leadIntent;
    this.leadQualification = props.leadQualification;
    this.handoffToHuman = props.handoffToHuman;
    this.reasoning = props.reasoning;
    this.recommendedModules = props.recommendedModules;
    this.interestedModules = props.interestedModules;
    this.quotedPlan = props.quotedPlan;
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
