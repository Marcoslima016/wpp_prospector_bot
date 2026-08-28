import { describe, expect, it } from "vitest";
import { loadConversationEngineEnv } from "./env.ts";

const validSource = {
  ANTHROPIC_API_KEY: "sk-ant-test",
};

describe("loadConversationEngineEnv", () => {
  it("aplica os valores padrão quando apenas a API key é informada", () => {
    const env = loadConversationEngineEnv(validSource);

    expect(env).toEqual({
      ANTHROPIC_API_KEY: "sk-ant-test",
      LLM_MODEL: "claude-sonnet-5",
      CONVERSATION_BATCH_WINDOW_MS: 8000,
      CONVERSATION_HISTORY_TURNS: 20,
      CONVERSATIONS_DIR: "./data/conversations",
      BOOT_SWEEP_MAX_AGE_MS: 3600000,
    });
  });

  it("respeita os overrides informados por variável de ambiente", () => {
    const env = loadConversationEngineEnv({
      ...validSource,
      LLM_MODEL: "claude-opus-5",
      CONVERSATION_BATCH_WINDOW_MS: "5000",
      CONVERSATION_HISTORY_TURNS: "10",
      CONVERSATIONS_DIR: "/var/data/conversas",
      BOOT_SWEEP_MAX_AGE_MS: "60000",
    });

    expect(env.LLM_MODEL).toBe("claude-opus-5");
    expect(env.CONVERSATION_BATCH_WINDOW_MS).toBe(5000);
    expect(env.CONVERSATION_HISTORY_TURNS).toBe(10);
    expect(env.CONVERSATIONS_DIR).toBe("/var/data/conversas");
    expect(env.BOOT_SWEEP_MAX_AGE_MS).toBe(60000);
  });

  it("não inclui ANTHROPIC_WORKSPACE_ID quando não informado", () => {
    const env = loadConversationEngineEnv(validSource);

    expect(env.ANTHROPIC_WORKSPACE_ID).toBeUndefined();
  });

  it("aceita ANTHROPIC_WORKSPACE_ID quando informado", () => {
    const env = loadConversationEngineEnv({ ...validSource, ANTHROPIC_WORKSPACE_ID: "wrkspc_123" });

    expect(env.ANTHROPIC_WORKSPACE_ID).toBe("wrkspc_123");
  });

  it("falha com mensagem clara quando ANTHROPIC_API_KEY está ausente", () => {
    expect(() => loadConversationEngineEnv({})).toThrow(/ANTHROPIC_API_KEY é obrigatório/);
  });
});
