import { WhatsAppSession } from './session';
import { WarmupTracker } from '../warmup/warmupTracker';

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
  private readonly warmupTracker?: WarmupTracker;

  constructor(maxConcurrentSessions = DEFAULT_MAX_CONCURRENT_SESSIONS, warmupTracker?: WarmupTracker) {
    this.maxConcurrentSessions = maxConcurrentSessions;
    this.warmupTracker = warmupTracker;
  }

  async addSession(sessionId: string): Promise<WhatsAppSession> {
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!;
    }
    if (this.sessions.size >= this.maxConcurrentSessions) {
      throw new MaxSessionsReachedError(this.maxConcurrentSessions);
    }

    const session = new WhatsAppSession(sessionId);
    // recordActivation is idempotent (only writes on first activation), so
    // it's safe to register this on every session without checking whether
    // it's reconnecting rather than pairing for the first time.
    const { warmupTracker } = this;
    if (warmupTracker) {
      session.on('ready', () => warmupTracker.recordActivation(sessionId));
    }
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
