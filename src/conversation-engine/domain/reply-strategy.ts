import type {
  LlmMessage,
  LlmRequest,
  LlmSystemBlock,
} from "../application/ports/llm-client.port.ts";
import { BOT_DECISION_JSON_SCHEMA } from "./bot-decision.ts";
import type { Conversation } from "./conversation.ts";

/**
 * Separador interno entre o conjunto fixo obrigatório (`pinned`) e os trechos
 * recuperados no turno, dentro da string devolvida pelo `BusinessContextProvider`.
 * O `pinned` entra no prefixo cacheável do `system`; os trechos recuperados,
 * fora dele.
 */
export const RETRIEVED_CONTEXT_SEPARATOR = "\n\n<<<TRECHOS-RECUPERADOS>>>\n\n";

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
 * a partir do histórico recente da conversa, do lote de mensagens novas e do
 * contexto de negócio recuperado para o turno.
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

  /**
   * @param businessContext string do `BusinessContextProvider`: o conjunto fixo
   * obrigatório, opcionalmente seguido de `RETRIEVED_CONTEXT_SEPARATOR` e dos
   * trechos recuperados no turno. String vazia = sem contexto de negócio.
   */
  buildRequest(
    conversation: Conversation,
    newMessages: string[],
    businessContext = "",
  ): LlmRequest {
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
      system: this.buildSystem(businessContext),
      messages,
      model: this.model,
      maxTokens: this.maxTokens,
      responseSchema: this.responseSchema,
    };
  }

  /**
   * Bloco 1 (cacheável): persona + conjunto fixo obrigatório (`pinned`).
   * Bloco 2 (não cacheável): trechos recuperados neste turno, quando houver.
   */
  private buildSystem(businessContext: string): LlmSystemBlock[] {
    const [pinned, retrieved] = splitBusinessContext(businessContext);

    const stablePrefix = pinned ? `${this.promptText}\n\n${pinned}` : this.promptText;

    const blocks: LlmSystemBlock[] = [{ text: stablePrefix, cacheable: true }];
    if (retrieved) {
      blocks.push({ text: retrieved, cacheable: false });
    }
    return blocks;
  }
}

function splitBusinessContext(businessContext: string): [pinned: string, retrieved: string] {
  const trimmed = businessContext.trim();
  if (!trimmed) return ["", ""];

  const idx = trimmed.indexOf(RETRIEVED_CONTEXT_SEPARATOR);
  if (idx === -1) return [trimmed, ""];

  return [
    trimmed.slice(0, idx).trim(),
    trimmed.slice(idx + RETRIEVED_CONTEXT_SEPARATOR.length).trim(),
  ];
}
