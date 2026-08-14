import Anthropic from '@anthropic-ai/sdk';
import type { ConversationIntent } from '../domain/conversation';
import type { ReasoningInput, ReasoningRepository, ReasoningResult } from '../domain/reasoningRepository';
import type { ReasoningConfig } from './reasoningConfig';

const RESPOND_TOOL_NAME = 'respond_to_lead';
const MAX_RESPONSE_TOKENS = 1024;

const RESPOND_TOOL: Anthropic.Tool = {
  name: RESPOND_TOOL_NAME,
  description:
    "Send the reply to the lead's latest WhatsApp message and classify the intent behind that message.",
  input_schema: {
    type: 'object',
    properties: {
      replyText: {
        type: 'string',
        description: 'The message to send back to the lead, in the same language they wrote in.',
      },
      intent: {
        type: 'string',
        enum: ['interested', 'not_interested', 'question', 'opt_out'],
        description:
          "Classification of the lead's intent: interested (wants to move forward), not_interested, question (needs clarification), or opt_out (asked to stop being contacted).",
      },
    },
    required: ['replyText', 'intent'],
  },
};

/**
 * The subset of the Anthropic client this repository depends on. Narrowing
 * to this shape (rather than the full Anthropic class) is what lets tests
 * inject a fake client instead of a real, network-backed one - the same
 * seam used for the Baileys socket in WhatsAppSession (see
 * BaileysSocketLike in src/whatsapp/session.ts).
 */
export type ClaudeMessagesClient = {
  messages: Pick<Anthropic['messages'], 'create'>;
};

/**
 * Implements ReasoningRepository via the Anthropic Messages API, using tool
 * use to force a structured { replyText, intent } response instead of
 * parsing free-form text (see design.md - "ReasoningRepository retorna
 * resultado estruturado").
 */
export class ClaudeReasoningRepository implements ReasoningRepository {
  private readonly client: ClaudeMessagesClient;
  private readonly config: ReasoningConfig;

  constructor(config: ReasoningConfig, client: ClaudeMessagesClient = new Anthropic()) {
    this.config = config;
    this.client = client;
  }

  async reason(input: ReasoningInput): Promise<ReasoningResult> {
    const response = await this.client.messages.create({
      model: this.config.model,
      max_tokens: MAX_RESPONSE_TOKENS,
      system: this.config.systemPrompt,
      messages: input.conversation.getTurns().map((turn) => ({
        role: turn.role === 'lead' ? 'user' : 'assistant',
        content: turn.text,
      })),
      tools: [RESPOND_TOOL],
      tool_choice: { type: 'tool', name: RESPOND_TOOL_NAME },
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );
    if (!toolUse) {
      throw new Error('Claude response did not include the expected tool use block');
    }

    const { replyText, intent } = toolUse.input as { replyText: string; intent: ConversationIntent };
    return { replyText, intent };
  }
}
