import { z } from "zod";

const envSchema = z.object({
  META_ACCESS_TOKEN: z.string().min(1, "META_ACCESS_TOKEN é obrigatório"),
  META_APP_SECRET: z.string().min(1, "META_APP_SECRET é obrigatório"),
  META_PHONE_NUMBER_ID: z.string().min(1, "META_PHONE_NUMBER_ID é obrigatório"),
  META_WABA_ID: z.string().min(1, "META_WABA_ID é obrigatório"),
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(1, "META_WEBHOOK_VERIFY_TOKEN é obrigatório"),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const missing = result.error.issues.map(
      (issue) => `- ${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`Configuração de ambiente inválida:\n${missing.join("\n")}`);
  }

  return result.data;
}
