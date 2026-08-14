import { test } from 'node:test';
import assert from 'node:assert/strict';
import type Anthropic from '@anthropic-ai/sdk';
import { Conversation } from '../domain/conversation';
import { ClaudeReasoningRepository, type ClaudeMessagesClient } from './claudeReasoningRepository';

/**
 * Stands in for the real Anthropic client - a real API call can't be
 * exercised in an automated test. Records the request it received and
 * returns a canned tool_use response.
 */
function createFakeClient(toolInput: unknown) {
  let lastParams: Anthropic.MessageCreateParamsNonStreaming | undefined;

  const client: ClaudeMessagesClient = {
    messages: {
      create: (async (params: Anthropic.MessageCreateParamsNonStreaming) => {
        lastParams = params;
        return {
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'respond_to_lead', input: toolInput }],
        } as unknown as Anthropic.Message;
      }) as ClaudeMessagesClient['messages']['create'],
    },
  };

  return {
    client,
    get lastParams() {
      return lastParams;
    },
  };
}

test('maps the conversation history into the API payload and the system prompt/model from config', async () => {
  const fake = createFakeClient({ replyText: 'Claro, posso te ajudar!', intent: 'question' });
  const repository = new ClaudeReasoningRepository(
    { model: 'claude-haiku-4-5-20251001', systemPrompt: 'Você é um SDR.' },
    fake.client,
  );

  const conversation = Conversation.empty('session-1', 'lead@s.whatsapp.net');
  conversation.addTurn('lead', 'oi, quero saber mais', 1_000);
  conversation.addTurn('bot', 'claro! sobre o que gostaria de saber?', 2_000);
  conversation.addTurn('lead', 'sobre o preço', 3_000);

  await repository.reason({ conversation });

  assert.equal(fake.lastParams?.model, 'claude-haiku-4-5-20251001');
  assert.equal(fake.lastParams?.system, 'Você é um SDR.');
  assert.deepEqual(fake.lastParams?.messages, [
    { role: 'user', content: 'oi, quero saber mais' },
    { role: 'assistant', content: 'claro! sobre o que gostaria de saber?' },
    { role: 'user', content: 'sobre o preço' },
  ]);
});

test('maps the tool_use response into { replyText, intent }', async () => {
  const fake = createFakeClient({ replyText: 'Perfeito, vamos agendar uma call!', intent: 'interested' });
  const repository = new ClaudeReasoningRepository(
    { model: 'claude-haiku-4-5-20251001', systemPrompt: 'Você é um SDR.' },
    fake.client,
  );

  const conversation = Conversation.empty('session-1', 'lead@s.whatsapp.net');
  conversation.addTurn('lead', 'tenho muito interesse!', 1_000);

  const result = await repository.reason({ conversation });

  assert.deepEqual(result, { replyText: 'Perfeito, vamos agendar uma call!', intent: 'interested' });
});

test('throws a clear error when the response does not include a tool_use block', async () => {
  const client: ClaudeMessagesClient = {
    messages: {
      create: (async () =>
        ({ content: [{ type: 'text', text: 'sem tool use' }] }) as unknown as Anthropic.Message) as unknown as ClaudeMessagesClient['messages']['create'],
    },
  };
  const repository = new ClaudeReasoningRepository(
    { model: 'claude-haiku-4-5-20251001', systemPrompt: 'Você é um SDR.' },
    client,
  );

  const conversation = Conversation.empty('session-1', 'lead@s.whatsapp.net');
  conversation.addTurn('lead', 'oi', 1_000);

  await assert.rejects(() => repository.reason({ conversation }), /did not include the expected tool use block/);
});
