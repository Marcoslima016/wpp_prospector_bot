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
  pairing_code: [code: string];
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
  | 'ev'
  | 'sendMessage'
  | 'sendPresenceUpdate'
  | 'onWhatsApp'
  | 'readMessages'
  | 'logout'
  | 'end'
  | 'requestPairingCode'
  | 'waitForSocketOpen'
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
  /**
   * Whether these auth credentials were already paired in a prior run -
   * true regardless of whether that pairing used QR or pairing code (see
   * defaultConnect for why neither Baileys field alone is reliable across
   * both methods).
   */
  registered: boolean;
}>;

export interface WhatsAppSessionOptions {
  authDataPath?: string;
  /** Test seam: inject a fake socket factory instead of a real Baileys connection. */
  connect?: BaileysConnect;
  /**
   * Phone number (digits, country code, no "+"/spaces) to pair via pairing
   * code instead of QR code. Ignored once the session is already registered.
   */
  pairingNumber?: string;
}

async function defaultConnect(authDataPath: string) {
  const { state, saveCreds } = await useMultiFileAuthState(authDataPath);
  const { version } = await fetchLatestBaileysVersion();

  // Baileys only sets creds.registered from the pairing-code flow's
  // "companion_finish" step (messages-recv.js) - a session paired via QR
  // never gets it set, even after a fully successful link. QR's own
  // pair-success handler (configureSuccessfulPairing, in socket.js) does
  // populate creds.account instead, so treat either as proof this session
  // already completed a pairing, regardless of which method was used.
  const registered = Boolean(state.creds.registered) || Boolean(state.creds.account);

  if (!registered && state.creds.me) {
    // requestPairingCode() sets creds.me speculatively - before the pairing
    // actually succeeds - and it gets persisted via creds.update. WhatsApp
    // closes the socket right after issuing a code, forcing the reconnect
    // this session already does; on that reconnect, Baileys' handshake
    // picks a registration vs. a login node based solely on whether
    // creds.me is set (validate-connection.js). With the stale speculative
    // value still on disk, it wrongly sends a login for a device that was
    // never actually registered, and WhatsApp rejects it with
    // `<failure reason="401">`. Clearing it here forces every retry to keep
    // using the registration handshake until a pairing genuinely succeeds -
    // matching how QR already behaves, since QR never sets creds.me before
    // success in the first place.
    delete state.creds.me;
  }

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    version,
  });
  return { sock: sock as BaileysSocketLike, saveCreds, registered };
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
  private readonly pairingNumber?: string;
  private sock?: BaileysSocketLike;
  private saveCreds?: () => Promise<void>;
  private status: SessionStatus = 'initializing';
  private stoppedIntentionally = false;
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;
  // WhatsApp closes the socket once a pairing code is issued and the code
  // stays valid across the reconnects that follow while the operator enters
  // it - so it must be requested at most once per unpaired session, not on
  // every reconnect attempt (each request invalidates the previous code).
  private pairingCodeRequested = false;

  constructor(sessionId: string, options: WhatsAppSessionOptions = {}) {
    super();
    this.sessionId = sessionId;
    this.authDataPath = options.authDataPath ?? `.baileys_auth/${sessionId}`;
    this.connect = options.connect ?? defaultConnect;
    this.pairingNumber = options.pairingNumber;
  }

  private async connectSocket(): Promise<void> {
    const { sock, saveCreds, registered } = await this.connect(this.authDataPath);
    this.sock = sock;
    this.saveCreds = saveCreds;
    this.registerEventHandlers(sock);

    if (this.pairingNumber && !registered && !this.pairingCodeRequested) {
      this.pairingCodeRequested = true;
      // The WebSocket handshake is still in flight right after connect()
      // returns; requestPairingCode() sends a stanza immediately and fails
      // with "Connection Closed" (428) if the socket isn't open yet.
      await sock.waitForSocketOpen();
      const code = await sock.requestPairingCode(this.pairingNumber);
      this.emit('pairing_code', code);
    }
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
        const boomError = lastDisconnect?.error as Boom | undefined;
        const statusCode = boomError?.output?.statusCode;
        this.emit('disconnected', this.describeDisconnect(statusCode, boomError));

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
   * Builds a diagnostic string for an unexpected disconnect - includes the
   * status code, the Boom message, and any server-sent payload (e.g. a
   * WhatsApp `<failure reason="..." location="...">` stanza), since the bare
   * status code alone isn't enough to tell a real error apart from routine
   * reconnects.
   */
  private describeDisconnect(statusCode: number | undefined, boomError: Boom | undefined): string {
    if (statusCode === undefined) {
      return 'unknown';
    }
    const parts = [String(statusCode)];
    if (boomError?.message) {
      parts.push(boomError.message);
    }
    if (boomError?.data) {
      parts.push(JSON.stringify(boomError.data));
    }
    return parts.join(' - ');
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
