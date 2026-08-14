import { WhatsAppSession } from './session';

const DEFAULT_MAX_CONCURRENT_SESSIONS = 5;

export class MaxSessionsReachedError extends Error {
  constructor(maxConcurrentSessions: number) {
    super(`Cannot add session: limit of ${maxConcurrentSessions} concurrent sessions reached`);
    this.name = 'MaxSessionsReachedError';
  }
}

/**
 * Owns the set of connected WhatsApp sessions. The platform is sized for a
 * small number of concurrently connected numbers (see whatsapp-connectivity
 * spec - "Bounded concurrent session count"), not a large pool, so the
 * limit here is a hard cap rather than an autoscaling concern.
 */
export class SessionManager {
  private readonly sessions = new Map<string, WhatsAppSession>();
  private readonly maxConcurrentSessions: number;

  constructor(maxConcurrentSessions = DEFAULT_MAX_CONCURRENT_SESSIONS) {
    this.maxConcurrentSessions = maxConcurrentSessions;
  }

  async addSession(sessionId: string): Promise<WhatsAppSession> {
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!;
    }
    if (this.sessions.size >= this.maxConcurrentSessions) {
      throw new MaxSessionsReachedError(this.maxConcurrentSessions);
    }

    const session = new WhatsAppSession(sessionId);
    this.sessions.set(sessionId, session);
    await session.start();
    return session;
  }

  async removeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    await session.stop();
    this.sessions.delete(sessionId);
  }

  getSession(sessionId: string): WhatsAppSession | undefined {
    return this.sessions.get(sessionId);
  }

  listSessions(): WhatsAppSession[] {
    return [...this.sessions.values()];
  }
}
