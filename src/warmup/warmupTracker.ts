import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

type ActivationRecord = Record<string, string>;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Persists the day each WhatsApp number was first activated, so the warmup
 * ramp survives process restarts instead of resetting on every redeploy.
 */
export class WarmupTracker {
  private readonly filePath: string;
  private readonly records: ActivationRecord;

  constructor(filePath = '.wwebjs_auth/warmup-activations.json') {
    this.filePath = filePath;
    this.records = this.load();
  }

  private load(): ActivationRecord {
    if (!existsSync(this.filePath)) {
      return {};
    }
    return JSON.parse(readFileSync(this.filePath, 'utf-8'));
  }

  private save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.records, null, 2));
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /** Records first activation if this session hasn't been seen before. Idempotent. */
  recordActivation(sessionId: string): void {
    if (this.records[sessionId]) {
      return;
    }
    this.records[sessionId] = this.today();
    this.save();
  }

  daysSinceActivation(sessionId: string): number {
    const activatedOn = this.records[sessionId];
    if (!activatedOn) {
      return 0;
    }
    const diff = Date.parse(this.today()) - Date.parse(activatedOn);
    return Math.max(0, Math.floor(diff / MS_PER_DAY));
  }
}
