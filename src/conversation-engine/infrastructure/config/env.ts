import { z } from "zod";

const envSchema = z.object({
  ANTHROPIC_API_KEY: z
    .string({ error: "ANTHROPIC_API_KEY é obrigatório" })
    .min(1, "ANTHROPIC_API_KEY é obrigatório"),
  // Obrigatório apenas quando a API key é vinculada à identidade (não a um
  // workspace). A Anthropic responde 400 pedindo o header `anthropic-workspace-id`.
  ANTHROPIC_WORKSPACE_ID: z.string().min(1).optional(),
  LLM_MODEL: z.string().min(1).default("claude-sonnet-5"),
  CONVERSATION_BATCH_WINDOW_MS: z.coerce.number().int().positive().default(8000),
  CONVERSATION_HISTORY_TURNS: z.coerce.number().int().positive().default(20),
  CONVERSATIONS_DIR: z.string().min(1).default("./data/conversations"),
  BOOT_SWEEP_MAX_AGE_MS: z.coerce.number().int().positive().default(3600000),
});

export type ConversationEngineEnv = z.infer<typeof envSchema>;

export function loadConversationEngineEnv(
  source: NodeJS.ProcessEnv = process.env,
): ConversationEngineEnv {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const missing = result.error.issues.map(
      (issue) => `- ${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`Configuração de ambiente inválida:\n${missing.join("\n")}`);
  }

  return result.data;
}
