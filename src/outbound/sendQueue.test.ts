import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SendQueue, type OutboundMessage, type VolumeGate } from './sendQueue';

function fakeGate(overrides: Partial<VolumeGate> = {}): VolumeGate & { sends: number } {
  const gate = {
    sends: 0,
    hasCapacity: () => true,
    recordSend() {
      gate.sends += 1;
    },
    msUntilReset: () => 0,
    ...overrides,
  };
  return gate;
}

function immediateQueue(send: (message: OutboundMessage) => Promise<void>, gates?: VolumeGate[]) {
  return new SendQueue(send, { jitter: { minDelayMs: 0, maxDelayMs: 0 }, gates });
}

test('sends immediately when there are no gates configured', async () => {
  const sent: OutboundMessage[] = [];
  const queue = immediateQueue(async (message) => {
    sent.push(message);
  });

  queue.enqueue({ sessionId: 's1', to: '123', text: 'oi' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sent.length, 1);
});

test('sends only when every gate has capacity', async () => {
  const sent: OutboundMessage[] = [];
  const openGate = fakeGate();
  const alsoOpenGate = fakeGate();
  const queue = immediateQueue(
    async (message) => {
      sent.push(message);
    },
    [openGate, alsoOpenGate],
  );

  queue.enqueue({ sessionId: 's1', to: '123', text: 'oi' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sent.length, 1);
  assert.equal(openGate.sends, 1);
  assert.equal(alsoOpenGate.sends, 1);
});

test('a single saturated gate holds the whole queue back', async () => {
  const sent: OutboundMessage[] = [];
  let saturated = true;
  const openGate = fakeGate();
  const saturatedGate = fakeGate({
    hasCapacity: () => !saturated,
    msUntilReset: () => 5,
  });
  const queue = immediateQueue(
    async (message) => {
      sent.push(message);
    },
    [openGate, saturatedGate],
  );

  queue.enqueue({ sessionId: 's1', to: '123', text: 'oi' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(sent.length, 0, 'queue should still be held while the gate is saturated');

  saturated = false;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(sent.length, 1, 'queue should drain once the gate frees up');
});

test('a failed send is logged and does not stop the queue or crash the process', async () => {
  const sent: OutboundMessage[] = [];
  const gate = fakeGate();
  const queue = immediateQueue(
    async (message) => {
      if (message.to === 'bad') {
        throw new Error('boom');
      }
      sent.push(message);
    },
    [gate],
  );

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    queue.enqueue({ sessionId: 's1', to: 'bad', text: 'oi' });
    queue.enqueue({ sessionId: 's1', to: 'good', text: 'oi2' });
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(sent, [{ sessionId: 's1', to: 'good', text: 'oi2' }]);
  // Only the successful send should count against the gate's budget.
  assert.equal(gate.sends, 1);
});

test('records a send on every configured gate after a successful send', async () => {
  const gateA = fakeGate();
  const gateB = fakeGate();
  const queue = immediateQueue(async () => {}, [gateA, gateB]);

  queue.enqueue({ sessionId: 's1', to: '123', text: 'oi' });
  queue.enqueue({ sessionId: 's1', to: '456', text: 'oi2' });
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(gateA.sends, 2);
  assert.equal(gateB.sends, 2);
});
