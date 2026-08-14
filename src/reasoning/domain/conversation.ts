export type ConversationRole = 'lead' | 'bot';

export type ConversationIntent = 'interested' | 'not_interested' | 'question' | 'opt_out';

export interface ConversationTurn {
  role: ConversationRole;
  text: string;
  timestamp: number;
}

export interface ConversationSnapshot {
  sessionId: string;
  leadJid: string;
  turns: ConversationTurn[];
  lastIntent?: ConversationIntent;
}

/**
 * The history of messages exchanged with a single lead on a single session,
 * keyed by (sessionId, leadJid). Reasoning about a new message always
 * happens in the context of this accumulated history (see
 * conversation-reasoning spec - "Conversation history informs each reply").
 */
export class Conversation {
  readonly sessionId: string;
  readonly leadJid: string;
  private turns: ConversationTurn[];
  private lastIntent?: ConversationIntent;

  private constructor(
    sessionId: string,
    leadJid: string,
    turns: ConversationTurn[],
    lastIntent?: ConversationIntent,
  ) {
    this.sessionId = sessionId;
    this.leadJid = leadJid;
    this.turns = turns;
    this.lastIntent = lastIntent;
  }

  static empty(sessionId: string, leadJid: string): Conversation {
    return new Conversation(sessionId, leadJid, []);
  }

  static fromSnapshot(snapshot: ConversationSnapshot): Conversation {
    return new Conversation(snapshot.sessionId, snapshot.leadJid, [...snapshot.turns], snapshot.lastIntent);
  }

  addTurn(role: ConversationRole, text: string, timestamp: number = Date.now()): void {
    this.turns.push({ role, text, timestamp });
  }

  recordIntent(intent: ConversationIntent): void {
    this.lastIntent = intent;
  }

  getTurns(): readonly ConversationTurn[] {
    return this.turns;
  }

  getLastIntent(): ConversationIntent | undefined {
    return this.lastIntent;
  }

  toSnapshot(): ConversationSnapshot {
    return {
      sessionId: this.sessionId,
      leadJid: this.leadJid,
      turns: [...this.turns],
      lastIntent: this.lastIntent,
    };
  }
}
