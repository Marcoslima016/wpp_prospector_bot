import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Conversation } from './conversation';

test('a new conversation starts with no turns and no classified intent', () => {
  const conversation = Conversation.empty('session-1', 'lead@s.whatsapp.net');

  assert.deepEqual(conversation.getTurns(), []);
  assert.equal(conversation.getLastIntent(), undefined);
});

test('addTurn appends turns and preserves the order they were added in', () => {
  const conversation = Conversation.empty('session-1', 'lead@s.whatsapp.net');

  conversation.addTurn('lead', 'oi, tudo bem?', 1_000);
  conversation.addTurn('bot', 'tudo ótimo! como posso ajudar?', 2_000);

  assert.deepEqual(conversation.getTurns(), [
    { role: 'lead', text: 'oi, tudo bem?', timestamp: 1_000 },
    { role: 'bot', text: 'tudo ótimo! como posso ajudar?', timestamp: 2_000 },
  ]);
});

test('recordIntent updates the last classified intent, overwriting any previous value', () => {
  const conversation = Conversation.empty('session-1', 'lead@s.whatsapp.net');

  conversation.recordIntent('question');
  assert.equal(conversation.getLastIntent(), 'question');

  conversation.recordIntent('interested');
  assert.equal(conversation.getLastIntent(), 'interested');
});

test('toSnapshot/fromSnapshot round-trips turns and last intent', () => {
  const original = Conversation.empty('session-1', 'lead@s.whatsapp.net');
  original.addTurn('lead', 'quero saber mais', 1_000);
  original.recordIntent('interested');

  const restored = Conversation.fromSnapshot(original.toSnapshot());

  assert.deepEqual(restored.getTurns(), original.getTurns());
  assert.equal(restored.getLastIntent(), 'interested');
  assert.equal(restored.sessionId, 'session-1');
  assert.equal(restored.leadJid, 'lead@s.whatsapp.net');
});

test('mutating a conversation built from a snapshot does not affect the original snapshot object', () => {
  const snapshot = {
    sessionId: 'session-1',
    leadJid: 'lead@s.whatsapp.net',
    turns: [{ role: 'lead' as const, text: 'oi', timestamp: 1_000 }],
  };

  const conversation = Conversation.fromSnapshot(snapshot);
  conversation.addTurn('bot', 'olá!', 2_000);

  assert.equal(snapshot.turns.length, 1);
});
