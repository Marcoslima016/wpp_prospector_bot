import { z } from "zod";

const envSchema = z.object({
  META_ACCESS_TOKEN: z.string().min(1, "META_ACCESS_TOKEN é obrigatório"),
  META_APP_SECRET: z.string().min(1, "META_APP_SECRET é obrigatório"),
  META_PHONE_NUMBER_ID: z.string().min(1, "META_PHONE_NUMBER_ID é obrigatório"),
  META_WABA_ID: z.string().min(1, "META_WABA_ID é obrigatório"),
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(1, "META_WEBHOOK_VERIFY_TOKEN é obrigatório"),
  PORT: z.coerce.number().int().positive().default(3000),
  // Liga/desliga o registro append-only de janelas de conversa de 24 h faturáveis
  // da Cloud API (fonte WhatsApp da capability `consumption-metrics`). Desligado,
  // o tratamento de status opera exatamente como sem a feature. Aceita apenas
  // "true"/"false".
  WHATSAPP_COST_TRACKING_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  // País-base assumido para estimar o custo de mensageria enquanto o sistema não
  // resolve o país real de cada destinatário. ISO-3166-1 alpha-2.
  WHATSAPP_BILLING_COUNTRY: z
    .string()
    .length(2, "WHATSAPP_BILLING_COUNTRY deve ter 2 letras (ISO-3166-1 alpha-2)")
    .default("BR")
    .transform((value) => value.toUpperCase()),
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
