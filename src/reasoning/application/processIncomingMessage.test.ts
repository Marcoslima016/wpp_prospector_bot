import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Conversation, type ConversationTurn } from '../domain/conversation';
import type { ConversationRepository } from '../domain/conversationRepository';
import type { ReasoningInput, ReasoningRepository, ReasoningResult } from '../domain/reasoningRepository';
import { ProcessIncomingMessage } from './processIncomingMessage';

class FakeConversationRepository implements ConversationRepository {
  private readonly store = new Map<string, Conversation>();
  saved: Conversation[] = [];

  private key(sessionId: string, leadJid: string): string {
    return `${sessionId}::${leadJid}`;
  }

  async load(sessionId: string, leadJid: string): Promise<Conversation> {
    return this.store.get(this.key(sessionId, leadJid)) ?? Conversation.empty(sessionId, leadJid);
  }

  async save(conversation: Conversation): Promise<void> {
    this.store.set(this.key(conversation.sessionId, conversation.leadJid), conversation);
    this.saved.push(conversation);
  }
}

class FakeReasoningRepository implements ReasoningRepository {
  // Snapshots of the turns visible *at call time* - processIncomingMessage
  // keeps mutating the same Conversation instance after this call returns
  // (adding the bot's turn, recording intent), so storing the live
  // ReasoningInput would let those later mutations leak into assertions.
  receivedTurns: readonly ConversationTurn[][] = [];

  constructor(private readonly result: ReasoningResult) {}

  async reason(input: ReasoningInput): Promise<ReasoningResult> {
    this.receivedTurns = [...this.receivedTurns, [...input.conversation.getTurns()]];
    return this.result;
  }
}

test('happy path: loads history, reasons, persists new turns + intent, sends the reply', async () => {
  const conversationRepository = new FakeConversationRepository();
  const reasoningRepository = new FakeReasoningRepository({
    replyText: 'Oi! Posso ajudar com isso.',
    intent: 'question',
  });
  const sentReplies: unknown[] = [];

  const useCase = new ProcessIncomingMessage(conversationRepository, reasoningRepository, async (reply) => {
    sentReplies.push(reply);
  });

  await useCase.execute('session-1', 'lead@s.whatsapp.net', 'oi, tenho uma dúvida', 1_000);

  assert.equal(reasoningRepository.receivedTurns.length, 1);
  assert.deepEqual(reasoningRepository.receivedTurns[0], [
    { role: 'lead', text: 'oi, tenho uma dúvida', timestamp: 1_000 },
  ]);

  const saved = conversationRepository.saved.at(-1)!;
  assert.equal(saved.getTurns().length, 2);
  assert.equal(saved.getTurns()[0]!.role, 'lead');
  assert.equal(saved.getTurns()[1]!.role, 'bot');
  assert.equal(saved.getTurns()[1]!.text, 'Oi! Posso ajudar com isso.');
  assert.equal(saved.getLastIntent(), 'question');

  assert.deepEqual(sentReplies, [
    { sessionId: 'session-1', to: 'lead@s.whatsapp.net', text: 'Oi! Posso ajudar com isso.' },
  ]);
});

test('opt_out intent is persisted but does not prevent the generated reply from being sent', async () => {
  const conversationRepository = new FakeConversationRepository();
  const reasoningRepository = new FakeReasoningRepository({
    replyText: 'Tudo bem, você não receberá mais mensagens.',
    intent: 'opt_out',
  });
  const sentReplies: unknown[] = [];

  const useCase = new ProcessIncomingMessage(conversationRepository, reasoningRepository, async (reply) => {
    sentReplies.push(reply);
  });

  await useCase.execute('session-1', 'lead@s.whatsapp.net', 'quero parar de receber mensagens', 1_000);

  const saved = conversationRepository.saved.at(-1)!;
  assert.equal(saved.getLastIntent(), 'opt_out');
  assert.equal(sentReplies.length, 1, 'reply must still be sent - opt_out is only classified/persisted in this version');
});

test('reasoning sees conversation history already on file, not just the new message', async () => {
  const conversationRepository = new FakeConversationRepository();
  const existing = Conversation.empty('session-1', 'lead@s.whatsapp.net');
  existing.addTurn('lead', 'oi', 500);
  existing.addTurn('bot', 'olá! como posso ajudar?', 600);
  await conversationRepository.save(existing);

  const reasoningRepository = new FakeReasoningRepository({ replyText: 'segue a resposta', intent: 'interested' });
  const useCase = new ProcessIncomingMessage(conversationRepository, reasoningRepository, async () => {});

  await useCase.execute('session-1', 'lead@s.whatsapp.net', 'quero saber o preço', 1_000);

  assert.deepEqual(
    reasoningRepository.receivedTurns[0]!.map((turn) => turn.text),
    ['oi', 'olá! como posso ajudar?', 'quero saber o preço'],
  );
});
