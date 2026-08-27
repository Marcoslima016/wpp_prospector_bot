import type { Conversation } from "../../domain/conversation.ts";

export interface ConversationRepositoryPort {
  /** Carrega a conversa do lead, ou `null` se ainda não existir. */
  load(leadPhone: string): Promise<Conversation | null>;
  /** Persiste a conversa de forma atômica. */
  save(conversation: Conversation): Promise<void>;
  /** Retorna todas as conversas que têm ao menos um turno inbound pendente de decisão. */
  findConversationsWithPendingInbound(): Promise<Conversation[]>;
}
