import { EventEmitter } from 'node:events';
import type { Boom } from '@hapi/boom';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidGroup,
  useMultiFileAuthState,
  type WAMessage,
  type WAMessageKey,
  type WASocket,
} from 'baileys';
import pino from 'pino';
import qrcodeTerminal from 'qrcode-terminal';

export type SessionStatus =
  | 'initializing'
  | 'qr_pending'
  | 'authenticated'
  | 'ready'
  | 'disconnected';

/** A one-to-one inbound message, already filtered of groups/self-sends - see toIncomingMessage(). */
export interface IncomingWhatsAppMessage {
  sessionId: string;
  from: string;
  text: string;
  timestamp: number;
}

export interface WhatsAppSessionEvents {
  qr: [qr: string];
  ready: [];
  disconnected: [reason: string];
  message: [message: IncomingWhatsAppMessage];
}

const RECONNECT_BASE_DELAY_MS = 5_000;
const RECONNECT_MAX_DELAY_MS = 5 * 60_000;
const MIN_TYPING_DELAY_MS = 800;
const MAX_TYPING_DELAY_MS = 6_000;
const TYPING_MS_PER_CHAR = 60;

/**
 * The subset of the Baileys socket surface WhatsAppSession depends on.
 * Narrowing to this shape (rather than the full WASocket) is what lets
 * tests inject a fake socket instead of a real, WebSocket-backed one.
 * Includes `readMessages` (beyond the connectivity primitives) because the
 * anti-ban-warmup spec's presence-simulation requirement covers marking
 * received messages as read, not just the "composing" indicator.
 */
export type BaileysSocketLike = Pick<
  WASocket,
  'ev' | 'sendMessage' | 'sendPresenceUpdate' | 'onWhatsApp' | 'readMessages' | 'logout' | 'end'
>;

/**
 * Connects (or reconnects) a session's socket, loading/persisting its
 * Baileys multi-device auth state along the way. Test seam: replaces the
 * real makeWASocket(...)/useMultiFileAuthState(...) pairing with a fake
 * socket factory, since makeWASocket is a plain function rather than a
 * class that can be subclassed/injected directly.
 */
export type BaileysConnect = (authDataPath: string) => Promise<{
  sock: BaileysSocketLike;
  saveCreds: () => Promise<void>;
}>;

export interface WhatsAppSessionOptions {
  authDataPath?: string;
  /** Test seam: inject a fake socket factory instead of a real Baileys connection. */
  connect?: BaileysConnect;
}

async function defaultConnect(authDataPath: string) {
  const { state, saveCreds } = await useMultiFileAuthState(authDataPath);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    version,
  });
  return { sock: sock as BaileysSocketLike, saveCreds };
}

/**
 * Wraps a single Baileys socket, exposing session lifecycle as events
 * (qr / ready / disconnected) instead of leaking the underlying socket to
 * callers.
 */
export class WhatsAppSession extends EventEmitter {
  readonly sessionId: string;
  private readonly authDataPath: string;
  private readonly connect: BaileysConnect;
  private sock?: BaileysSocketLike;
  private saveCreds?: () => Promise<void>;
  private status: SessionStatus = 'initializing';
  private stoppedIntentionally = false;
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;

  constructor(sessionId: string, options: WhatsAppSessionOptions = {}) {
    super();
    this.sessionId = sessionId;
    this.authDataPath = options.authDataPath ?? `.baileys_auth/${sessionId}`;
    this.connect = options.connect ?? defaultConnect;
  }

  private async connectSocket(): Promise<void> {
    const { sock, saveCreds } = await this.connect(this.authDataPath);
    this.sock = sock;
    this.saveCreds = saveCreds;
    this.registerEventHandlers(sock);
  }

  private registerEventHandlers(sock: BaileysSocketLike): void {
    sock.ev.on('creds.update', () => {
      void this.saveCreds?.();
    });

    sock.ev.on('connection.update', (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr) {
        this.status = 'qr_pending';
        qrcodeTerminal.generate(qr, { small: true });
        this.emit('qr', qr);
      }

      if (connection === 'open') {
        this.status = 'ready';
        this.reconnectAttempts = 0;
        this.emit('ready');
      }

      if (connection === 'close') {
        this.status = 'disconnected';
        const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        this.emit('disconnected', statusCode !== undefined ? String(statusCode) : 'unknown');

        const loggedOut = statusCode === DisconnectReason.loggedOut;
        if (!loggedOut && !this.stoppedIntentionally) {
          this.scheduleReconnect();
        }
      }
    });

    // Presence simulation: mark incoming messages as read, the way a human
    // reading their chats would, instead of leaving them silently unread.
    sock.ev.on('messages.upsert', ({ messages }) => {
      const incomingKeys = messages
        .map((message) => message.key)
        .filter((key): key is WAMessageKey => Boolean(key && !key.fromMe));
      if (incomingKeys.length > 0) {
        void sock.readMessages(incomingKeys);
      }

      for (const message of messages) {
        const incoming = this.toIncomingMessage(message);
        if (incoming) {
          this.emit('message', incoming);
        }
      }
    });
  }

  /**
   * Narrows a raw upsert entry down to the one-to-one, text-bearing messages
   * the reasoning layer cares about - excludes group chats, this session's
   * own sends, and non-text content (e.g. media without a caption).
   */
  private toIncomingMessage(message: WAMessage): IncomingWhatsAppMessage | undefined {
    const remoteJid = message.key.remoteJid;
    if (!remoteJid || message.key.fromMe || isJidGroup(remoteJid)) {
      return undefined;
    }

    const text = message.message?.conversation ?? message.message?.extendedTextMessage?.text;
    if (!text) {
      return undefined;
    }

    const timestamp = Number(message.messageTimestamp ?? 0);
    return {
      sessionId: this.sessionId,
      from: remoteJid,
      text,
      timestamp: timestamp > 0 ? timestamp * 1000 : Date.now(),
    };
  }

  /**
   * Sends a message with a "composing" presence signal beforehand, timed
   * roughly to the message length, so the send doesn't appear instantly.
   */
  async sendMessage(to: string, text: string): Promise<void> {
    if (!this.sock) {
      throw new Error(`Session "${this.sessionId}" is not connected`);
    }
    const sock = this.sock;

    // Resolve to WhatsApp's canonical JID first: a hand-built
    // "<number>@s.whatsapp.net" string doesn't always match the account's
    // real addressing (e.g. contacts resolved via the newer @lid scheme),
    // which is what made sends fail systemically under the previous client.
    const [result] = (await sock.onWhatsApp(to)) ?? [];
    if (!result?.exists) {
      throw new Error(`Number is not registered on WhatsApp: ${to}`);
    }
    const jid = result.jid;

    await sock.sendPresenceUpdate('composing', jid);
    await this.delay(this.typingDelayFor(text));
    await sock.sendMessage(jid, { text });
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
      this.connectSocket().catch(() => {
        // 'connection.update' fires again (via 'close') for the underlying
        // socket failure and re-schedules the next attempt, so a failed
        // retry here is a no-op.
      });
    }, delay);
  }

  getStatus(): SessionStatus {
    return this.status;
  }

  async start(): Promise<void> {
    this.stoppedIntentionally = false;
    await this.connectSocket();
  }

  async stop(): Promise<void> {
    this.stoppedIntentionally = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.sock?.end(undefined);
  }
}
