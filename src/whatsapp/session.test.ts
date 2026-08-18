import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Boom } from '@hapi/boom';
import { DisconnectReason } from 'baileys';
import { WhatsAppSession, type BaileysConnect, type BaileysSocketLike } from './session';

/**
 * Stands in for a real Baileys socket. A real pairing (scanning a QR code
 * with a phone) can't be exercised in an automated test - this covers the
 * session's own state-transition, reconnection and presence logic instead.
 */
class FakeSocket {
  readonly ev = new EventEmitter();
  sendMessageCalls: { jid: string; content: unknown }[] = [];
  presenceCalls: { type: string; jid: string | undefined }[] = [];
  readMessagesCalls: unknown[][] = [];
  endCalls = 0;
  onWhatsAppResult: { jid: string; exists: unknown; lid: unknown }[] = [];
  pairingCodeRequests: string[] = [];
  pairingCodeToReturn = 'ABCD1234';

  async sendMessage(jid: string, content: unknown): Promise<undefined> {
    this.sendMessageCalls.push({ jid, content });
    return undefined;
  }

  async sendPresenceUpdate(type: string, jid?: string): Promise<void> {
    this.presenceCalls.push({ type, jid });
  }

  async onWhatsApp(..._jids: string[]) {
    return this.onWhatsAppResult;
  }

  async readMessages(keys: unknown[]): Promise<void> {
    this.readMessagesCalls.push(keys);
  }

  async logout(): Promise<void> {}

  end(_error: Error | undefined): void {
    this.endCalls += 1;
  }

  async requestPairingCode(phoneNumber: string): Promise<string> {
    this.pairingCodeRequests.push(phoneNumber);
    return this.pairingCodeToReturn;
  }

  async waitForSocketOpen(): Promise<void> {}
}

/**
 * connectSocket() only invokes the injected factory once start() runs, so
 * callers must await session.start() before reading `.sock` - it reflects
 * whichever socket the most recent connect() call produced.
 */
function createSession(options: { registered?: boolean; pairingNumber?: string } = {}) {
  const sockets: FakeSocket[] = [];
  let saveCredsCalls = 0;
  const registered = options.registered ?? false;

  const connect: BaileysConnect = async () => {
    const sock = new FakeSocket();
    sockets.push(sock);
    return {
      sock: sock as unknown as BaileysSocketLike,
      saveCreds: async () => {
        saveCredsCalls += 1;
      },
      registered,
    };
  };

  const session = new WhatsAppSession('test-session', { connect, pairingNumber: options.pairingNumber });
  return {
    session,
    get sock() {
      return sockets[sockets.length - 1]!;
    },
    get connectCalls() {
      return sockets.length;
    },
    get saveCredsCalls() {
      return saveCredsCalls;
    },
  };
}

test('transitions through qr -> ready', async () => {
  const ctx = createSession();
  await ctx.session.start();
  assert.equal(ctx.session.getStatus(), 'initializing');

  ctx.sock.ev.emit('connection.update', { qr: 'fake-qr-data' });
  assert.equal(ctx.session.getStatus(), 'qr_pending');

  ctx.sock.ev.emit('connection.update', { connection: 'open' });
  assert.equal(ctx.session.getStatus(), 'ready');
});

test('emits qr and ready events for callers to observe', async () => {
  const ctx = createSession();
  let qrReceived: string | undefined;
  let readyFired = false;
  ctx.session.on('qr', (qr: string) => (qrReceived = qr));
  ctx.session.on('ready', () => (readyFired = true));

  await ctx.session.start();
  ctx.sock.ev.emit('connection.update', { qr: 'fake-qr-data' });
  ctx.sock.ev.emit('connection.update', { connection: 'open' });

  assert.equal(qrReceived, 'fake-qr-data');
  assert.equal(readyFired, true);
});

test('requests a pairing code and emits it when a pairing number is configured for an unregistered session', async () => {
  const ctx = createSession({ pairingNumber: '5511999999999', registered: false });
  let pairingCodeReceived: string | undefined;
  ctx.session.on('pairing_code', (code: string) => (pairingCodeReceived = code));

  await ctx.session.start();

  assert.deepEqual(ctx.sock.pairingCodeRequests, ['5511999999999']);
  assert.equal(pairingCodeReceived, ctx.sock.pairingCodeToReturn);
});

test('does not request a pairing code when the session is already registered', async () => {
  const ctx = createSession({ pairingNumber: '5511999999999', registered: true });

  await ctx.session.start();

  assert.deepEqual(ctx.sock.pairingCodeRequests, []);
});

test('does not request a pairing code when no pairing number is configured (QR flow unaffected)', async () => {
  const ctx = createSession();
  let qrReceived: string | undefined;
  ctx.session.on('qr', (qr: string) => (qrReceived = qr));

  await ctx.session.start();
  ctx.sock.ev.emit('connection.update', { qr: 'fake-qr-data' });

  assert.deepEqual(ctx.sock.pairingCodeRequests, []);
  assert.equal(qrReceived, 'fake-qr-data');
});

test('describes an unexpected disconnect with statusCode, message, and any server-sent data', async () => {
  const ctx = createSession();
  let disconnectReason: string | undefined;
  ctx.session.on('disconnected', (reason: string) => (disconnectReason = reason));
  await ctx.session.start();

  const error = new Boom('Connection Failure', { statusCode: 401, data: { reason: '401', location: 'atn' } });
  ctx.sock.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error, date: new Date() } });

  assert.equal(disconnectReason, '401 - Connection Failure - {"reason":"401","location":"atn"}');
});

test('describes an unexpected disconnect as "unknown" when there is no status code', async () => {
  const ctx = createSession();
  let disconnectReason: string | undefined;
  ctx.session.on('disconnected', (reason: string) => (disconnectReason = reason));
  await ctx.session.start();

  ctx.sock.ev.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: undefined, date: new Date() },
  });

  assert.equal(disconnectReason, 'unknown');
});

test('does not request a new pairing code on reconnect while still unregistered', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ctx = createSession({ pairingNumber: '5511999999999', registered: false });

  await ctx.session.start();
  assert.equal(ctx.sock.pairingCodeRequests.length, 1);

  ctx.sock.ev.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: new Error('socket hiccup'), date: new Date() },
  });
  t.mock.timers.tick(5_000);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(ctx.connectCalls, 2, 'should have reconnected');
  assert.equal(
    ctx.sock.pairingCodeRequests.length,
    0,
    'the new socket from the reconnect should not receive a new pairing code request',
  );
});

test('does not attempt to reconnect after an intentional stop', async () => {
  const ctx = createSession();
  await ctx.session.start();
  assert.equal(ctx.connectCalls, 1);

  const sock = ctx.sock;
  await ctx.session.stop();
  assert.equal(sock.endCalls, 1);

  sock.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: undefined, date: new Date() } });
  assert.equal(ctx.session.getStatus(), 'disconnected');
  assert.equal(ctx.connectCalls, 1, 'should not re-connect after an intentional stop');
});

test('schedules a reconnect attempt after an unexpected disconnect', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ctx = createSession();

  return ctx.session.start().then(() => {
    ctx.sock.ev.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: new Error('socket hiccup'), date: new Date() },
    });
    assert.equal(ctx.connectCalls, 1, 'should not reconnect immediately');

    t.mock.timers.tick(5_000);
    assert.equal(ctx.connectCalls, 2, 'should retry after the backoff delay');
  });
});

test('treats a logged-out disconnect as definitive and does not reconnect', async () => {
  const ctx = createSession();
  await ctx.session.start();

  const loggedOutError = new Boom('logged out', { statusCode: DisconnectReason.loggedOut });
  ctx.sock.ev.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: loggedOutError, date: new Date() },
  });

  assert.equal(ctx.session.getStatus(), 'disconnected');
  assert.equal(ctx.connectCalls, 1, 'should not reconnect once the account has logged the session out');
});

test('calls saveCreds() whenever the socket emits creds.update', async () => {
  const ctx = createSession();
  await ctx.session.start();

  ctx.sock.ev.emit('creds.update', {});

  assert.equal(ctx.saveCredsCalls, 1);
});

test('sendMessage resolves the WhatsApp JID before signaling presence and sending', async () => {
  const ctx = createSession();
  await ctx.session.start();
  ctx.sock.onWhatsAppResult = [{ jid: '5511999999999@s.whatsapp.net', exists: true, lid: undefined }];

  await ctx.session.sendMessage('5511999999999', 'oi');

  assert.deepEqual(ctx.sock.presenceCalls, [{ type: 'composing', jid: '5511999999999@s.whatsapp.net' }]);
  assert.deepEqual(ctx.sock.sendMessageCalls, [
    { jid: '5511999999999@s.whatsapp.net', content: { text: 'oi' } },
  ]);
});

test('sendMessage rejects a number that is not registered on WhatsApp', async () => {
  const ctx = createSession();
  await ctx.session.start();
  ctx.sock.onWhatsAppResult = [];

  await assert.rejects(() => ctx.session.sendMessage('0000000000', 'oi'), /not registered on WhatsApp/);
});

test('sendMessage rejects when the session has not been started yet', async () => {
  const ctx = createSession();

  await assert.rejects(() => ctx.session.sendMessage('5511999999999', 'oi'), /not connected/);
});

test('marks incoming messages as read, skipping messages sent by this session (presence simulation)', async () => {
  const ctx = createSession();
  await ctx.session.start();

  const incomingKey = { remoteJid: '5511999999999@s.whatsapp.net', id: 'ABC', fromMe: false };
  const ownKey = { remoteJid: '5511999999999@s.whatsapp.net', id: 'DEF', fromMe: true };
  ctx.sock.ev.emit('messages.upsert', { messages: [{ key: incomingKey }, { key: ownKey }], type: 'notify' });

  assert.deepEqual(ctx.sock.readMessagesCalls, [[incomingKey]]);
});

test('emits "message" for a one-to-one text message', async () => {
  const ctx = createSession();
  await ctx.session.start();

  const received: unknown[] = [];
  ctx.session.on('message', (message) => received.push(message));

  const key = { remoteJid: '5511999999999@s.whatsapp.net', id: 'ABC', fromMe: false };
  ctx.sock.ev.emit('messages.upsert', {
    messages: [{ key, message: { conversation: 'oi' }, messageTimestamp: 1_700_000_000 }],
    type: 'notify',
  });

  assert.deepEqual(received, [
    {
      sessionId: 'test-session',
      from: '5511999999999@s.whatsapp.net',
      text: 'oi',
      timestamp: 1_700_000_000_000,
    },
  ]);
});

test('reads text from extendedTextMessage when "conversation" is absent', async () => {
  const ctx = createSession();
  await ctx.session.start();

  const received: unknown[] = [];
  ctx.session.on('message', (message) => received.push(message));

  const key = { remoteJid: '5511999999999@s.whatsapp.net', id: 'ABC', fromMe: false };
  ctx.sock.ev.emit('messages.upsert', {
    messages: [{ key, message: { extendedTextMessage: { text: 'quoted reply' } } }],
    type: 'notify',
  });

  assert.equal((received[0] as { text: string }).text, 'quoted reply');
});

test('does not emit "message" for a group chat', async () => {
  const ctx = createSession();
  await ctx.session.start();

  const received: unknown[] = [];
  ctx.session.on('message', (message) => received.push(message));

  const key = { remoteJid: '123456789-987654321@g.us', id: 'ABC', fromMe: false };
  ctx.sock.ev.emit('messages.upsert', {
    messages: [{ key, message: { conversation: 'oi grupo' } }],
    type: 'notify',
  });

  assert.deepEqual(received, []);
});

test('does not emit "message" for a message sent by this session itself', async () => {
  const ctx = createSession();
  await ctx.session.start();

  const received: unknown[] = [];
  ctx.session.on('message', (message) => received.push(message));

  const key = { remoteJid: '5511999999999@s.whatsapp.net', id: 'DEF', fromMe: true };
  ctx.sock.ev.emit('messages.upsert', {
    messages: [{ key, message: { conversation: 'meu proprio envio' } }],
    type: 'notify',
  });

  assert.deepEqual(received, []);
});

test('does not emit "message" for content without text (e.g. media without caption)', async () => {
  const ctx = createSession();
  await ctx.session.start();

  const received: unknown[] = [];
  ctx.session.on('message', (message) => received.push(message));

  const key = { remoteJid: '5511999999999@s.whatsapp.net', id: 'ABC', fromMe: false };
  ctx.sock.ev.emit('messages.upsert', {
    messages: [{ key, message: { imageMessage: { caption: undefined } } }],
    type: 'notify',
  });

  assert.deepEqual(received, []);
});
