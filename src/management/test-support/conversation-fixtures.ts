import { BotDecision } from "../../conversation-engine/domain/bot-decision.ts";
import { Conversation } from "../../conversation-engine/domain/conversation.ts";
import type { LeadIntent } from "../../conversation-engine/domain/lead-intent.ts";
import type { LeadQualification } from "../../conversation-engine/domain/lead-qualification.ts";
import type { CommercialPlan, ModuleId } from "../../conversation-engine/domain/product-catalog.ts";

export interface ConversationSpec {
  leadPhone: string;
  /** Timestamp do turno outbound; os turnos inbound ficam em torno dele. */
  at?: Date;
  intent?: LeadIntent;
  qualification?: LeadQualification | null;
  quotedPlan?: CommercialPlan | null;
  end?: boolean;
  handoff?: boolean;
  recommendedModules?: ModuleId[];
  interestedModules?: ModuleId[];
  /** Acrescenta um turno inbound pendente ao fim (has_pending_inbound = 1). */
  pendingInbound?: boolean;
  /** Acrescenta um turno inbound marcado como abandonado ao fim. */
  abandonedInbound?: boolean;
}

const DEFAULT_AT = new Date("2026-09-02T12:00:00.000Z");

/** Monta um agregado `Conversation` coerente para os testes da projeção/queries. */
export function buildConversation(spec: ConversationSpec): Conversation {
  const at = spec.at ?? DEFAULT_AT;
  const conversation = Conversation.createNew(spec.leadPhone);

  conversation.recordInboundTurn({
    text: "oi",
    timestamp: new Date(at.getTime() - 60_000),
    messageId: `${spec.leadPhone}-in-1`,
  });

  conversation.applyDecision(
    BotDecision.create({
      replyMessages: ["olá!"],
      endConversation: spec.end ?? false,
      leadIntent: spec.intent ?? "interested",
      leadQualification: spec.qualification ?? "warm",
      handoffToHuman: spec.handoff ?? false,
      reasoning: "fixture",
      recommendedModules: spec.recommendedModules ?? [],
      interestedModules: spec.interestedModules ?? [],
      quotedPlan: spec.quotedPlan ?? null,
    }),
    at,
  );

  if (spec.pendingInbound) {
    conversation.recordInboundTurn({
      text: "ainda aí?",
      timestamp: new Date(at.getTime() + 60_000),
      messageId: `${spec.leadPhone}-in-2`,
    });
  }

  if (spec.abandonedInbound) {
    conversation.recordInboundTurn({
      text: "deixa pra lá",
      timestamp: new Date(at.getTime() + 120_000),
      messageId: `${spec.leadPhone}-in-3`,
    });
    conversation.markPendingAbandoned();
  }

  return conversation;
}
