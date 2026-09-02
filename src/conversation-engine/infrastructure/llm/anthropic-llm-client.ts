import Anthropic from "@anthropic-ai/sdk";
import { LlmClientError } from "../../application/errors.ts";
import type {
  LlmClientPort,
  LlmRequest,
  LlmResponse,
  LlmSystemBlock,
  LlmUsage,
} from "../../application/ports/llm-client.port.ts";

export interface AnthropicLlmClientConfig {
  apiKey: string;
  /**
   * Id do workspace. Necessário quando a API key é vinculada à identidade —
   * enviado no header `anthropic-workspace-id`.
   */
  workspaceId?: string;
  /** Cliente já construído — usado nos testes com um SDK mockado. */
  client?: Anthropic;
}

/** Adapter de `LlmClientPort` sobre o `@anthropic-ai/sdk` com saída estruturada. */
export class AnthropicLlmClient implements LlmClientPort {
  private readonly client: Anthropic;

  constructor(config: AnthropicLlmClientConfig) {
    this.client =
      config.client ??
      new Anthropic({
        apiKey: config.apiKey,
        ...(config.workspaceId
          ? { defaultHeaders: { "anthropic-workspace-id": config.workspaceId } }
          : {}),
      });
  }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    let message: Anthropic.Message;

    try {
      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model: request.model,
        max_tokens: request.maxTokens,
        system: toAnthropicSystem(request.system),
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
        ...(request.responseSchema
          ? {
              output_config: {
                format: { type: "json_schema", schema: request.responseSchema },
              },
            }
          : {}),
      };

      message = await this.client.messages.create(params);
    } catch (cause) {
      if (cause instanceof Anthropic.APIError) {
        throw new LlmClientError(`Anthropic API respondeu com erro: ${cause.message}`, { cause });
      }
      throw new LlmClientError("Falha ao chamar a Anthropic API", { cause });
    }

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (!text) {
      throw new LlmClientError("Resposta da Anthropic API sem conteúdo de texto utilizável");
    }

    return { text, usage: toLlmUsage(message, request.model) };
  }
}

/**
 * Mapeia `message.usage`/`message.model` para `LlmUsage`. Os contadores de cache
 * vêm `null` quando não há prompt caching — coeridos para `0`. O `request-id` é
 * anexado pelo SDK ao objeto de resposta (`_request_id`); ausente nos testes com
 * SDK mockado.
 */
function toLlmUsage(
  message: Anthropic.Message & { _request_id?: string | null },
  requestedModel: string,
): LlmUsage {
  const usage = message.usage as Anthropic.Usage | undefined;
  return {
    model: message.model ?? requestedModel,
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
    ...(message._request_id ? { requestId: message._request_id } : {}),
  };
}

/**
 * Converte o `system` do `LlmRequest` para o formato da Anthropic. String →
 * string (sem cache). Blocos → array de `text` blocks, com `cache_control`
 * ephemeral no bloco marcado como `cacheable` (breakpoint de prompt caching).
 */
function toAnthropicSystem(system: string | LlmSystemBlock[]): string | Anthropic.TextBlockParam[] {
  if (typeof system === "string") return system;

  return system
    .filter((block) => block.text.trim().length > 0)
    .map((block) => ({
      type: "text" as const,
      text: block.text,
      ...(block.cacheable ? { cache_control: { type: "ephemeral" as const } } : {}),
    }));
}
