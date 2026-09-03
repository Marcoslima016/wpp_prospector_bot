import type { ConversationRepositoryPort } from "../../conversation-engine/application/ports/conversation-repository.port.ts";
import { Conversation } from "../../conversation-engine/domain/conversation.ts";

/** Repositório de conversas em memória para os testes da API de gestão. */
export class InMemoryConversationRepository implements ConversationRepositoryPort {
  private readonly store = new Map<string, Conversation>();

  seed(conversation: Conversation): void {
    this.store.set(conversation.leadPhone, conversation);
  }

  load(leadPhone: string): Promise<Conversation | null> {
    const found = this.store.get(leadPhone);
    if (!found) return Promise.resolve(null);
    // Devolve uma cópia desacoplada, como faria um repositório de verdade.
    return Promise.resolve(Conversation.fromJSON(JSON.parse(JSON.stringify(found.toJSON()))));
  }

  save(conversation: Conversation): Promise<void> {
    this.store.set(conversation.leadPhone, conversation);
    return Promise.resolve();
  }

  findConversationsWithPendingInbound(): Promise<Conversation[]> {
    return Promise.resolve(
      [...this.store.values()].filter((c) => c.pendingInboundTurns.length > 0),
    );
  }
}
