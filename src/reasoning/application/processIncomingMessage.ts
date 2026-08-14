import type { ConversationRepository } from '../domain/conversationRepository';
import type { ReasoningRepository } from '../domain/reasoningRepository';

export interface OutgoingReply {
  sessionId: string;
  to: string;
  text: string;
}

export type ReplySender = (reply: OutgoingReply) => void | Promise<void>;

/**
 * Orchestrates a single inbound message: load the lead's conversation
 * history, ask the reasoning port for a contextual reply + classified
 * intent, persist the new turns, and hand the reply off to the outbound
 * pipeline (see design.md - "resposta automática entra na SendQueue
 * existente").
 */
export class ProcessIncomingMessage {
  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly reasoningRepository: ReasoningRepository,
    private readonly sendReply: ReplySender,
  ) {}

  async execute(sessionId: string, leadJid: string, text: string, timestamp: number = Date.now()): Promise<void> {
    const conversation = await this.conversationRepository.load(sessionId, leadJid);
    conversation.addTurn('lead', text, timestamp);

    const { replyText, intent } = await this.reasoningRepository.reason({ conversation });

    // Intent is recorded for RF-04 visibility only - it does not gate or
    // otherwise change whether/how the reply below is sent (see
    // conversation-reasoning spec - "Intent classification does not alter
    // automated behavior yet").
    conversation.addTurn('bot', replyText, Date.now());
    conversation.recordIntent(intent);

    await this.conversationRepository.save(conversation);

    await this.sendReply({ sessionId, to: leadJid, text: replyText });
  }
}
