import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WhatsAppSession, type WhatsAppClientLike } from './session';

/**
 * Stands in for a real whatsapp-web.js Client. A real pairing (scanning a
 * QR code with a phone) can't be exercised in an automated test - this
 * covers the session's own state-transition and reconnection logic instead.
 */
class FakeClient extends EventEmitter {
  initializeCalls = 0;
  destroyCalls = 0;

  async initialize(): Promise<void> {
    this.initializeCalls += 1;
  }

  async destroy(): Promise<void> {
    this.destroyCalls += 1;
  }

  async getChatById(): Promise<never> {
    throw new Error('not used in this test');
  }

  async sendMessage(): Promise<never> {
    throw new Error('not used in this test');
  }

  async sendSeen(_chatId: string): Promise<boolean> {
    return true;
  }
}

function createSession() {
  const fakeClient = new FakeClient();
  const session = new WhatsAppSession('test-session', {
    client: fakeClient as unknown as WhatsAppClientLike,
  });
  return { session, fakeClient };
}

test('transitions through qr -> authenticated -> ready', () => {
  const { session, fakeClient } = createSession();
  assert.equal(session.getStatus(), 'initializing');

  fakeClient.emit('qr', 'fake-qr-data');
  assert.equal(session.getStatus(), 'qr_pending');

  fakeClient.emit('authenticated');
  assert.equal(session.getStatus(), 'authenticated');

  fakeClient.emit('ready');
  assert.equal(session.getStatus(), 'ready');
});

test('emits qr and ready events for callers to observe', () => {
  const { session, fakeClient } = createSession();
  let qrReceived: string | undefined;
  let readyFired = false;
  session.on('qr', (qr: string) => (qrReceived = qr));
  session.on('ready', () => (readyFired = true));

  fakeClient.emit('qr', 'fake-qr-data');
  fakeClient.emit('ready');

  assert.equal(qrReceived, 'fake-qr-data');
  assert.equal(readyFired, true);
});

test('does not attempt to reconnect after an intentional stop', async () => {
  const { session, fakeClient } = createSession();
  await session.start();
  assert.equal(fakeClient.initializeCalls, 1);

  await session.stop();
  assert.equal(fakeClient.destroyCalls, 1);

  fakeClient.emit('disconnected', 'LOGOUT');
  assert.equal(session.getStatus(), 'disconnected');
  assert.equal(fakeClient.initializeCalls, 1, 'should not re-initialize after an intentional stop');
});

test('schedules a reconnect attempt after an unexpected disconnect', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { fakeClient } = createSession();

  fakeClient.emit('disconnected', 'NAVIGATION');
  assert.equal(fakeClient.initializeCalls, 0, 'should not reconnect immediately');

  t.mock.timers.tick(5_000);
  assert.equal(fakeClient.initializeCalls, 1, 'should retry after the backoff delay');
});

test('marks incoming messages as seen (presence simulation)', () => {
  const { fakeClient } = createSession();
  let seenChatId: string | undefined;
  fakeClient.sendSeen = async (chatId: string) => {
    seenChatId = chatId;
    return true;
  };

  fakeClient.emit('message', { from: '5511999999999@c.us' });

  assert.equal(seenChatId, '5511999999999@c.us');
});
