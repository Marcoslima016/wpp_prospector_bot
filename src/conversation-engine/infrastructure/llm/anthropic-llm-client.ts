import Anthropic from "@anthropic-ai/sdk";
import { LlmClientError } from "../../application/errors.ts";
import type {
  LlmClientPort,
  LlmRequest,
  LlmResponse,
} from "../../application/ports/llm-client.port.ts";

export interface AnthropicLlmClientConfig {
  apiKey: string;
  /** Cliente já construído — usado nos testes com um SDK mockado. */
  client?: Anthropic;
}

/** Adapter de `LlmClientPort` sobre o `@anthropic-ai/sdk` com saída estruturada. */
export class AnthropicLlmClient implements LlmClientPort {
  private readonly client: Anthropic;

  constructor(config: AnthropicLlmClientConfig) {
    this.client = config.client ?? new Anthropic({ apiKey: config.apiKey });
  }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    let message: Anthropic.Message;

    try {
      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model: request.model,
        max_tokens: request.maxTokens,
        system: request.system,
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

    return { text };
  }
}
