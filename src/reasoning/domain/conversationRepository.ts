import type { Conversation } from './conversation';

/**
 * Persists conversation history per (sessionId, leadJid). load() returns an
 * empty Conversation when none exists yet, so callers don't need to
 * special-case a "first message from this lead" scenario.
 */
export interface ConversationRepository {
  load(sessionId: string, leadJid: string): Promise<Conversation>;
  save(conversation: Conversation): Promise<void>;
}
