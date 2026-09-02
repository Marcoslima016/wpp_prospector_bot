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

  it("envia o header anthropic-workspace-id quando workspaceId é informado", () => {
    const adapter = new AnthropicLlmClient({ apiKey: "sk-ant-test", workspaceId: "wrkspc_123" });

    const options = (adapter as unknown as { client: { _options: { defaultHeaders?: unknown } } })
      .client._options;
    expect(options.defaultHeaders).toEqual({ "anthropic-workspace-id": "wrkspc_123" });
  });

  it("não define defaultHeaders quando workspaceId não é informado", () => {
    const adapter = new AnthropicLlmClient({ apiKey: "sk-ant-test" });

    const options = (adapter as unknown as { client: { _options: { defaultHeaders?: unknown } } })
      .client._options;
    expect(options.defaultHeaders).toBeUndefined();
  });

  it("omite output_config quando não há responseSchema", async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "oi" }] });

    await clientWith(create).generate({ ...request, responseSchema: undefined });

    const params = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(params.output_config).toBeUndefined();
  });

  it("mapeia system em blocos para text blocks com cache_control ephemeral no bloco cacheável", async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "{}" }] });

    await clientWith(create).generate({
      ...request,
      system: [
        { text: "PERSONA + PINNED", cacheable: true },
        { text: "TRECHOS RECUPERADOS", cacheable: false },
      ],
    });

    const params = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(params.system).toEqual([
      { type: "text", text: "PERSONA + PINNED", cache_control: { type: "ephemeral" } },
      { type: "text", text: "TRECHOS RECUPERADOS" },
    ]);
  });

  it("mantém system como string quando não há blocos", async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "{}" }] });

    await clientWith(create).generate(request);

    const params = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(params.system).toBe("PROMPT");
  });
});
