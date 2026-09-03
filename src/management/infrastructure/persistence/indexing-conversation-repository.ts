import type { ConversationRepositoryPort } from "../../../conversation-engine/application/ports/conversation-repository.port.ts";
import type { Conversation } from "../../../conversation-engine/domain/conversation.ts";
import type { Logger } from "../../application/ports/logger.port.ts";
import type { ConversationIndexProjection } from "./conversation-index-projection.ts";

/**
 * Decorator de `ConversationRepositoryPort` que mantém a projeção de leitura em
 * dia. Delega tudo ao repositório real e, após um `save()` bem-sucedido, faz o
 * UPSERT na projeção. Best-effort: uma falha ao indexar é logada e engolida — a
 * fonte da verdade é o arquivo e o índice se reconstrói no próximo boot. O motor
 * recebe um `ConversationRepositoryPort` e não sabe que a projeção existe.
 */
export class IndexingConversationRepository implements ConversationRepositoryPort {
  constructor(
    private readonly inner: ConversationRepositoryPort,
    private readonly projection: ConversationIndexProjection,
    private readonly logger: Logger,
  ) {}

  load(leadPhone: string): Promise<Conversation | null> {
    return this.inner.load(leadPhone);
  }

  async save(conversation: Conversation): Promise<void> {
    await this.inner.save(conversation);
    try {
      this.projection.upsertFromConversation(conversation);
    } catch (error) {
      this.logger.warn(
        "Falha ao atualizar a projeção de conversas — índice será reconstruído no próximo boot",
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
