import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Conversation, type ConversationSnapshot } from '../domain/conversation';
import type { ConversationRepository } from '../domain/conversationRepository';

function sanitizeForFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9.-]/g, '_');
}

/**
 * Persists one JSON file per (sessionId, leadJid) conversation, the same
 * local-file approach already used by WarmupTracker/DailyVolumeLimiter, so
 * conversation history survives a process restart (see conversation-
 * reasoning spec - "Conversation history persists across restarts").
 */
export class FileConversationRepository implements ConversationRepository {
  private readonly baseDir: string;

  constructor(baseDir = '.baileys_auth/conversations') {
    this.baseDir = baseDir;
  }

  private filePathFor(sessionId: string, leadJid: string): string {
    return join(this.baseDir, sanitizeForFilename(sessionId), `${sanitizeForFilename(leadJid)}.json`);
  }

  async load(sessionId: string, leadJid: string): Promise<Conversation> {
    const filePath = this.filePathFor(sessionId, leadJid);
    if (!existsSync(filePath)) {
      return Conversation.empty(sessionId, leadJid);
    }
    const snapshot: ConversationSnapshot = JSON.parse(readFileSync(filePath, 'utf-8'));
    return Conversation.fromSnapshot(snapshot);
  }

  async save(conversation: Conversation): Promise<void> {
    const filePath = this.filePathFor(conversation.sessionId, conversation.leadJid);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(conversation.toSnapshot(), null, 2));
  }
}
