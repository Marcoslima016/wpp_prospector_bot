import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileConversationRepository } from './fileConversationRepository';

function tempBaseDir(t: import('node:test').TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'file-conversation-repository-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('load() returns an empty conversation when none was saved yet', async (t) => {
  const repository = new FileConversationRepository(tempBaseDir(t));

  const conversation = await repository.load('session-1', 'lead@s.whatsapp.net');

  assert.deepEqual(conversation.getTurns(), []);
  assert.equal(conversation.sessionId, 'session-1');
  assert.equal(conversation.leadJid, 'lead@s.whatsapp.net');
});

test('save() then load() round-trips the conversation state', async (t) => {
  const repository = new FileConversationRepository(tempBaseDir(t));

  const conversation = await repository.load('session-1', 'lead@s.whatsapp.net');
  conversation.addTurn('lead', 'oi', 1_000);
  conversation.addTurn('bot', 'olá! como posso ajudar?', 2_000);
  conversation.recordIntent('question');
  await repository.save(conversation);

  const reloaded = await repository.load('session-1', 'lead@s.whatsapp.net');
  assert.deepEqual(reloaded.getTurns(), conversation.getTurns());
  assert.equal(reloaded.getLastIntent(), 'question');
});

test('persists across a new repository instance pointed at the same directory (restart)', async (t) => {
  const baseDir = tempBaseDir(t);

  const first = new FileConversationRepository(baseDir);
  const conversation = await first.load('session-1', 'lead@s.whatsapp.net');
  conversation.addTurn('lead', 'mensagem antes do restart', 1_000);
  await first.save(conversation);

  const afterRestart = new FileConversationRepository(baseDir);
  const reloaded = await afterRestart.load('session-1', 'lead@s.whatsapp.net');
  assert.deepEqual(reloaded.getTurns(), [{ role: 'lead', text: 'mensagem antes do restart', timestamp: 1_000 }]);
});

test('keeps different leads and sessions in separate files', async (t) => {
  const repository = new FileConversationRepository(tempBaseDir(t));

  const leadA = await repository.load('session-1', 'lead-a@s.whatsapp.net');
  leadA.addTurn('lead', 'sou o lead A', 1_000);
  await repository.save(leadA);

  const leadB = await repository.load('session-1', 'lead-b@s.whatsapp.net');
  assert.deepEqual(leadB.getTurns(), []);

  const otherSession = await repository.load('session-2', 'lead-a@s.whatsapp.net');
  assert.deepEqual(otherSession.getTurns(), []);
});
