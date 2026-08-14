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

/** A capacity check a send must clear before it's allowed to go out. */
export interface VolumeGate {
  hasCapacity(): boolean;
  recordSend(): void;
  msUntilReset(): number;
}

export interface SendQueueOptions {
  jitter?: Partial<JitterConfig>;
  /** When set, sends beyond any gate's capacity stay queued until it resets. */
  gates?: VolumeGate[];
}

/**
 * Sends queued outbound messages one at a time, waiting a randomized
 * (jittered) delay between consecutive sends so the cadence doesn't look
 * mechanical. When volume gates are configured, messages beyond any gate's
 * capacity stay queued instead of being dropped.
 */
export class SendQueue {
  private readonly queue: OutboundMessage[] = [];
  private readonly jitter: JitterConfig;
  private readonly send: MessageSender;
  private readonly gates: VolumeGate[];
  private processing = false;

  constructor(send: MessageSender, options: SendQueueOptions = {}) {
    this.send = send;
    this.jitter = { ...DEFAULT_JITTER, ...options.jitter };
    this.gates = options.gates ?? [];
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
        const saturatedGates = this.gates.filter((gate) => !gate.hasCapacity());
        if (saturatedGates.length > 0) {
          // At least one gate is saturated: hold the remaining queue until
          // the longest-blocking one resets, rather than sending beyond any
          // ceiling or dropping messages.
          const waitMs = Math.max(...saturatedGates.map((gate) => gate.msUntilReset()));
          await this.delay(waitMs);
          continue;
        }

        const message = this.queue.shift()!;
        try {
          await this.send(message);
          for (const gate of this.gates) {
            gate.recordSend();
          }
        } catch (error) {
          // A single failed send (e.g. a transient WhatsApp Web hiccup)
          // must not take down the whole queue/process; log and move on.
          console.error(`Failed to send message to ${message.to}:`, error);
        }
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
