import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { WarmupSchedule } from './warmupSchedule';
import { WarmupTracker } from './warmupTracker';

interface GateState {
  date: string; // YYYY-MM-DD
  count: number;
}

/**
 * Enforces the per-number warmup ramp (see anti-ban-warmup spec - "Gradual
 * warmup ramp for new numbers") before a send goes out. Unlike
 * DailyVolumeLimiter, the ceiling isn't fixed at construction: it's
 * recalculated on every call from WarmupSchedule + WarmupTracker, since the
 * allowed volume grows as the ramp advances day over day.
 */
export class PerSessionWarmupGate {
  private readonly filePath: string;
  private readonly sessionId: string;
  private readonly fullAllotment: number;
  private readonly schedule: WarmupSchedule;
  private readonly tracker: WarmupTracker;
  private state: GateState;

  constructor(
    sessionId: string,
    fullAllotment: number,
    schedule: WarmupSchedule,
    tracker: WarmupTracker,
    filePath = `.baileys_auth/warmup-gate-${sessionId}.json`,
  ) {
    this.sessionId = sessionId;
    this.fullAllotment = fullAllotment;
    this.schedule = schedule;
    this.tracker = tracker;
    this.filePath = filePath;
    this.state = this.load();
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private load(): GateState {
    if (existsSync(this.filePath)) {
      const saved: GateState = JSON.parse(readFileSync(this.filePath, 'utf-8'));
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

  private allowedToday(): number {
    const daysSinceActivation = this.tracker.daysSinceActivation(this.sessionId);
    return this.schedule.allowedVolume(daysSinceActivation, this.fullAllotment);
  }

  hasCapacity(): boolean {
    this.rolloverIfNewDay();
    return this.state.count < this.allowedToday();
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
