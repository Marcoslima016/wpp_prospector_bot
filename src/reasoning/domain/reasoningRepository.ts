import type { Conversation, ConversationIntent } from './conversation';

export interface ReasoningInput {
  conversation: Conversation;
}

export interface ReasoningResult {
  replyText: string;
  intent: ConversationIntent;
}

/**
 * Abstracts "thinking" about a conversation and producing a reply + a
 * classified lead intent, independently of which LLM provider does it (see
 * design.md - "ReasoningRepository retorna resultado estruturado").
 */
export interface ReasoningRepository {
  reason(input: ReasoningInput): Promise<ReasoningResult>;
}
