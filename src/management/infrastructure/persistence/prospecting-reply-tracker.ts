import type { ConversationRepositoryPort } from "../../../conversation-engine/application/ports/conversation-repository.port.ts";
import type { Conversation } from "../../../conversation-engine/domain/conversation.ts";
import type { LeadRepositoryPort } from "../../application/ports/lead-repository.port.ts";
import type { Logger } from "../../application/ports/logger.port.ts";

/**
 * Decorator de `ConversationRepositoryPort` que liga o primeiro inbound de um
 * lead prospectado ao estado `replied`. Após cada `save()` bem-sucedido, se a
 * conversa já tem ao menos um turno inbound e existe um lead em `sent`, promove-o
 * a `replied`. Best-effort: uma falha é apenas logada — o estado converge no
 * próximo `save()` ou reconciliação. O motor de conversas não sabe que isto
 * existe. Não conhece a projeção de leitura; encadeia-se por fora dela.
 */
export class ProspectingReplyTracker implements ConversationRepositoryPort {
  constructor(
    private readonly inner: ConversationRepositoryPort,
    private readonly leads: LeadRepositoryPort,
    private readonly logger: Logger,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  load(leadPhone: string): Promise<Conversation | null> {
    return this.inner.load(leadPhone);
  }

  async save(conversation: Conversation): Promise<void> {
    await this.inner.save(conversation);

    try {
      const hasInbound = conversation.turns.some((turn) => turn.direction === "inbound");
      if (!hasInbound) return;

      const lead = await this.leads.findByPhone(conversation.leadPhone);
      if (lead?.prospectingState === "sent") {
        await this.leads.markReplied(conversation.leadPhone, this.clock());
      }
    } catch (error) {
      this.logger.warn(
        "Falha ao ligar o inbound do lead à prospecção — o estado convergirá depois",
        {
          leadPhone: conversation.leadPhone,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  findConversationsWithPendingInbound(): Promise<Conversation[]> {
    return this.inner.findConversationsWithPendingInbound();
  }
}
