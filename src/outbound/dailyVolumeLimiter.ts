import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

interface LimiterState {
  date: string; // YYYY-MM-DD
  count: number;
}

/**
 * Enforces a hard ceiling on total outbound messages sent per day across
 * the whole platform (see anti-ban-warmup spec - "Daily volume ceiling
 * enforcement"), regardless of how many sessions are sending.
 */
export class DailyVolumeLimiter {
  private readonly filePath: string;
  private readonly dailyLimit: number;
  private state: LimiterState;

  constructor(dailyLimit: number, filePath = '.baileys_auth/daily-volume.json') {
    this.dailyLimit = dailyLimit;
    this.filePath = filePath;
    this.state = this.load();
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private load(): LimiterState {
    if (existsSync(this.filePath)) {
      const saved: LimiterState = JSON.parse(readFileSync(this.filePath, 'utf-8'));
      if (saved.date === this.today()) {
        return saved;
      }
    }
    return { date: this.today(), count: 0 };
  }

  private save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  private rolloverIfNewDay(): void {
    const today = this.today();
    if (this.state.date !== today) {
      this.state = { date: today, count: 0 };
    }
  }

  hasCapacity(): boolean {
    this.rolloverIfNewDay();
    return this.state.count < this.dailyLimit;
  }

  remainingToday(): number {
    this.rolloverIfNewDay();
    return Math.max(0, this.dailyLimit - this.state.count);
  }

  recordSend(): void {
    this.rolloverIfNewDay();
    this.state.count += 1;
    this.save();
  }

  /** Milliseconds until the ceiling resets (next UTC midnight). */
  msUntilReset(): number {
    const now = new Date();
    const tomorrow = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    );
    return tomorrow.getTime() - now.getTime();
  }
}
