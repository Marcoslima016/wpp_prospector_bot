import { EventEmitter } from 'node:events';
import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcodeTerminal from 'qrcode-terminal';

export type SessionStatus =
  | 'initializing'
  | 'qr_pending'
  | 'authenticated'
  | 'ready'
  | 'disconnected';

export interface WhatsAppSessionEvents {
  qr: [qr: string];
  ready: [];
  disconnected: [reason: string];
}

const RECONNECT_BASE_DELAY_MS = 5_000;
const RECONNECT_MAX_DELAY_MS = 5 * 60_000;
const MIN_TYPING_DELAY_MS = 800;
const MAX_TYPING_DELAY_MS = 6_000;
const TYPING_MS_PER_CHAR = 60;

/**
 * The subset of the whatsapp-web.js Client surface WhatsAppSession depends
 * on. Narrowing to this shape (rather than the full Client) is what lets
 * tests inject a fake client instead of a real, browser-backed one.
 */
export type WhatsAppClientLike = Pick<
  Client,
  'on' | 'initialize' | 'destroy' | 'getChatById' | 'sendMessage' | 'sendSeen'
>;

export interface WhatsAppSessionOptions {
  authDataPath?: string;
  /** Test seam: inject a fake client instead of a real whatsapp-web.js Client. */
  client?: WhatsAppClientLike;
}

/**
 * Wraps a single whatsapp-web.js Client, exposing session lifecycle as
 * events (qr / ready / disconnected) instead of leaking the underlying
 * client to callers.
 */
export class WhatsAppSession extends EventEmitter {
  readonly sessionId: string;
  protected readonly client: WhatsAppClientLike;
  private status: SessionStatus = 'initializing';
  private stoppedIntentionally = false;
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;

  constructor(sessionId: string, options: WhatsAppSessionOptions = {}) {
    super();
    this.sessionId = sessionId;
    this.client =
      options.client ??
      new Client({
        authStrategy: new LocalAuth({
          clientId: sessionId,
          dataPath: options.authDataPath ?? '.wwebjs_auth',
        }),
      });
    this.registerEventHandlers();
  }

  private registerEventHandlers(): void {
    this.client.on('qr', (qr) => {
      this.status = 'qr_pending';
      qrcodeTerminal.generate(qr, { small: true });
      this.emit('qr', qr);
    });

    this.client.on('authenticated', () => {
      this.status = 'authenticated';
    });

    this.client.on('ready', () => {
      this.status = 'ready';
      this.reconnectAttempts = 0;
      this.emit('ready');
    });

    this.client.on('disconnected', (reason: string) => {
      this.status = 'disconnected';
      this.emit('disconnected', reason);
      if (!this.stoppedIntentionally) {
        this.scheduleReconnect();
      }
    });

    // Presence simulation: mark incoming messages as read, the way a human
    // reading their chats would, instead of leaving them silently unread.
    this.client.on('message', (message) => {
      void this.client.sendSeen(message.from);
    });
  }

  /**
   * Sends a message with a "composing" presence signal beforehand, timed
   * roughly to the message length, so the send doesn't appear instantly.
   */
  async sendMessage(to: string, text: string): Promise<void> {
    const chat = await this.client.getChatById(to);
    await chat.sendStateTyping();
    await this.delay(this.typingDelayFor(text));
    await this.client.sendMessage(to, text);
  }

  private typingDelayFor(text: string): number {
    return Math.min(
      MAX_TYPING_DELAY_MS,
      Math.max(MIN_TYPING_DELAY_MS, text.length * TYPING_MS_PER_CHAR),
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private scheduleReconnect(): void {
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempts,
      RECONNECT_MAX_DELAY_MS,
    );
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.client.initialize().catch(() => {
        // 'disconnected' fires again for the underlying client failure and
        // re-schedules the next attempt, so a failed retry here is a no-op.
      });
    }, delay);
  }

  getStatus(): SessionStatus {
    return this.status;
  }

  async start(): Promise<void> {
    this.stoppedIntentionally = false;
    await this.client.initialize();
  }

  async stop(): Promise<void> {
    this.stoppedIntentionally = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    await this.client.destroy();
  }
}
