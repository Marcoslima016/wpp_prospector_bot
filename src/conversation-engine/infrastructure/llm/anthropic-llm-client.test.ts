import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { LlmClientError } from "../../application/errors.ts";
import type { LlmRequest } from "../../application/ports/llm-client.port.ts";
import { AnthropicLlmClient } from "./anthropic-llm-client.ts";

const request: LlmRequest = {
  system: "PROMPT",
  messages: [{ role: "user", content: "olá" }],
  model: "claude-sonnet-5",
  maxTokens: 2000,
  responseSchema: { type: "object" },
};

function clientWith(create: ReturnType<typeof vi.fn>): AnthropicLlmClient {
  const fake = { messages: { create } } as unknown as Anthropic;
  return new AnthropicLlmClient({ apiKey: "sk-ant-test", client: fake });
}

describe("AnthropicLlmClient.generate", () => {
  it("retorna o texto concatenado dos blocos de texto e envia output_config a partir do responseSchema", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        { type: "text", text: '{"replyMessages":[]' },
        { type: "text", text: ',"endConversation":false}' },
      ],
    });

    const result = await clientWith(create).generate(request);

    expect(result.text).toBe('{"replyMessages":[],"endConversation":false}');
    const params = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(params.model).toBe("claude-sonnet-5");
    expect(params.max_tokens).toBe(2000);
    expect(params.output_config).toEqual({
      format: { type: "json_schema", schema: { type: "object" } },
    });
  });

  it("mapeia erro do SDK para LlmClientError", async () => {
    const create = vi.fn().mockRejectedValue(new Error("500 Internal Server Error"));

    await expect(clientWith(create).generate(request)).rejects.toBeInstanceOf(LlmClientError);
  });

  it("lança LlmClientError quando a resposta não tem conteúdo de texto utilizável", async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: "tool_use", id: "x" }] });

    await expect(clientWith(create).generate(request)).rejects.toBeInstanceOf(LlmClientError);
  });

  it("omite output_config quando não há responseSchema", async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "oi" }] });

    await clientWith(create).generate({ ...request, responseSchema: undefined });

    const params = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(params.output_config).toBeUndefined();
  });
});
