import type { Conversation } from "../../conversation-engine/domain/conversation.ts";
import type { ConversationDetail } from "./dto/conversation.dto.ts";

type DetailTurn = ConversationDetail["turns"][number];

/**
 * Agregado `Conversation` → `ConversationDetail` (contrato de resposta). Lê do
 * agregado carregado da fonte da verdade; reaproveita `toJSON()` para os turnos
 * e acrescenta as flags derivadas (pendência de inbound, abandono/inatividade).
 * Todo turno outbound leva `origin` (default `"bot"` para turnos gravados antes
 * desta capability).
 */
export function toConversationDetail(conversation: Conversation): ConversationDetail {
  const serialized = conversation.toJSON();
  const turns = conversation.turns;
  const lastTurn = turns.at(-1);

  return {
    leadPhone: conversation.leadPhone,
    state: conversation.state,
    leadIntent: conversation.leadIntent,
    leadQualification: conversation.leadQualification,
    recommendedModules: [...conversation.recommendedModules],
    interestedModules: [...conversation.interestedModules],
    quotedPlan: conversation.quotedPlan,
    hasPendingInbound: conversation.pendingInboundTurns.length > 0,
    hasAbandonedInbound: turns.some((turn) => turn.direction === "inbound" && turn.abandoned),
    turnCount: turns.length,
    lastActivityAt: lastTurn ? lastTurn.timestamp.toISOString() : null,
    turns: serialized.turns.map((turn): DetailTurn => {
      if (turn.direction === "inbound") {
        return {
          direction: "inbound",
          text: turn.text,
          timestamp: turn.timestamp,
          messageId: turn.messageId,
          pendingDecision: turn.pendingDecision,
          abandoned: turn.abandoned,
        };
      }
      return {
        direction: "outbound",
        text: turn.text,
        timestamp: turn.timestamp,
        origin: turn.origin ?? "bot",
        leadIntent: turn.leadIntent,
        leadQualification: turn.leadQualification,
        reasoning: turn.reasoning,
        recommendedModules: turn.recommendedModules,
        interestedModules: turn.interestedModules,
        quotedPlan: turn.quotedPlan,
      };
    }),
  };
}
