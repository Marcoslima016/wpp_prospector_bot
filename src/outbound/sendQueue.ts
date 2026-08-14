import { DailyVolumeLimiter } from './dailyVolumeLimiter';

export interface JitterConfig {
  minDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_JITTER: JitterConfig = {
  minDelayMs: 3_000,
  maxDelayMs: 15_000,
};

export interface OutboundMessage {
  sessionId: string;
  to: string;
  text: string;
}

export type MessageSender = (message: OutboundMessage) => Promise<void>;

export interface SendQueueOptions {
  jitter?: Partial<JitterConfig>;
  /** When set, sends beyond its daily ceiling stay queued until the ceiling resets. */
  dailyLimiter?: DailyVolumeLimiter;
}

/**
 * Sends queued outbound messages one at a time, waiting a randomized
 * (jittered) delay between consecutive sends so the cadence doesn't look
 * mechanical. When a daily volume limiter is configured, messages beyond
 * the day's ceiling stay queued instead of being dropped.
 */
export class SendQueue {
  private readonly queue: OutboundMessage[] = [];
  private readonly jitter: JitterConfig;
  private readonly send: MessageSender;
  private readonly dailyLimiter?: DailyVolumeLimiter;
  private processing = false;

  constructor(send: MessageSender, options: SendQueueOptions = {}) {
    this.send = send;
    this.jitter = { ...DEFAULT_JITTER, ...options.jitter };
    this.dailyLimiter = options.dailyLimiter;
  }

  enqueue(message: OutboundMessage): void {
    this.queue.push(message);
    void this.processQueue();
  }

  get pending(): number {
    return this.queue.length;
  }

  private async processQueue(): Promise<void> {
    if (this.processing) {
      return;
    }
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        if (this.dailyLimiter && !this.dailyLimiter.hasCapacity()) {
          // Daily ceiling reached: hold the remaining queue until it resets
          // rather than sending beyond the target or dropping messages.
          await this.delay(this.dailyLimiter.msUntilReset());
          continue;
        }

        const message = this.queue.shift()!;
        await this.send(message);
        this.dailyLimiter?.recordSend();
        if (this.queue.length > 0) {
          await this.delay(this.randomDelay());
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private randomDelay(): number {
    const { minDelayMs, maxDelayMs } = this.jitter;
    return minDelayMs + Math.random() * (maxDelayMs - minDelayMs);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
