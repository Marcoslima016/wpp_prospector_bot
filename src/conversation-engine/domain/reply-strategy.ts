import type { LlmMessage, LlmRequest } from "../application/ports/llm-client.port.ts";
import { BOT_DECISION_JSON_SCHEMA } from "./bot-decision.ts";
import type { Conversation } from "./conversation.ts";

export interface ReplyStrategyConfig {
  /** Texto do prompt de prospecção predefinido (system prompt). */
  promptText: string;
  /** Identificador do modelo de LLM a usar. */
  model: string;
  /** Número máximo de turnos recentes do histórico incluídos no prompt. */
  historyTurns: number;
  /** Teto de tokens da resposta. Respostas de conversa são curtas. */
  maxTokens?: number;
}

/**
 * Domain service que detém o prompt de prospecção e monta a requisição ao LLM
 * a partir do histórico recente da conversa somado ao lote de mensagens novas.
 */
export class ReplyStrategy {
  private readonly promptText: string;
  private readonly model: string;
  private readonly historyTurns: number;
  private readonly maxTokens: number;

  constructor(config: ReplyStrategyConfig) {
    this.promptText = config.promptText;
    this.model = config.model;
    this.historyTurns = config.historyTurns;
    this.maxTokens = config.maxTokens ?? 2000;
  }

  /** JSON Schema da decisão estruturada exigida do LLM. */
  get responseSchema(): Record<string, unknown> {
    return BOT_DECISION_JSON_SCHEMA as unknown as Record<string, unknown>;
  }

  buildRequest(conversation: Conversation, newMessages: string[]): LlmRequest {
    const history = conversation.turns.filter(
      (turn) => !(turn.direction === "inbound" && turn.pendingDecision),
    );

    const recent = this.historyTurns > 0 ? history.slice(-this.historyTurns) : [];

    const messages: LlmMessage[] = recent.map((turn) => ({
      role: turn.direction === "outbound" ? "assistant" : "user",
      content: turn.text,
    }));

    for (const text of newMessages) {
      messages.push({ role: "user", content: text });
    }

    return {
      system: this.promptText,
      messages,
      model: this.model,
      maxTokens: this.maxTokens,
      responseSchema: this.responseSchema,
    };
  }
}
