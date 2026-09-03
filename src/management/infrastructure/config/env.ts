import { z } from "zod";

const envSchema = z
  .object({
    // Liga/desliga toda a superfície `/admin` (API + estáticos). Aceita apenas
    // "true"/"false". Desligado, o processo sobe só com o webhook público.
    ADMIN_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    // Segredo compartilhado trocado por um cookie de sessão em `POST /admin/api/session`.
    // Obrigatório quando `ADMIN_ENABLED=true`.
    ADMIN_ACCESS_SECRET: z.string().min(1).optional(),
    // Segredo de servidor que assina o cookie de sessão (HMAC-SHA256). Trocá-lo
    // invalida todas as sessões emitidas. Obrigatório quando `ADMIN_ENABLED=true`.
    ADMIN_SESSION_SECRET: z.string().min(1).optional(),
    // Validade do cookie de sessão, em ms. Default 12h; re-login ao expirar.
    ADMIN_SESSION_TTL_MS: z.coerce.number().int().positive().default(43_200_000),
    // Diretório do build da SPA de gestão, relativo ao diretório do processo.
    // Servido sob `/admin` só quando existir (a UI chega em outra change).
    ADMIN_WEB_DIST_DIR: z.string().min(1).default("../wpp_prospector_bot_panel/dist"),
  })
  .refine(
    (value) =>
      !value.ADMIN_ENABLED ||
      (value.ADMIN_ACCESS_SECRET !== undefined && value.ADMIN_SESSION_SECRET !== undefined),
    {
      error:
        "ADMIN_ACCESS_SECRET e ADMIN_SESSION_SECRET são obrigatórios quando ADMIN_ENABLED=true",
      path: ["ADMIN_ACCESS_SECRET"],
    },
  );

export type ManagementEnv = z.infer<typeof envSchema>;

/**
 * Configuração da superfície `/admin` já resolvida: os segredos deixam de ser
 * opcionais (o schema garante a presença quando ligada) e o TTL/dir vêm normalizados.
 */
export interface ResolvedAdminConfig {
  accessSecret: string;
  sessionSecret: string;
  sessionTtlMs: number;
  webDistDir: string;
}

/**
 * `null` quando `ADMIN_ENABLED=false` — o caller não deve registrar o plugin
 * `/admin` nem embrulhar o repositório com a projeção.
 */
export function resolveAdminConfig(env: ManagementEnv): ResolvedAdminConfig | null {
  if (!env.ADMIN_ENABLED) return null;
  if (env.ADMIN_ACCESS_SECRET === undefined || env.ADMIN_SESSION_SECRET === undefined) {
    // Inalcançável: o `refine` do schema já falha o parse. Guardado para o type-narrowing.
    throw new Error(
      "Configuração /admin inconsistente: segredos ausentes com ADMIN_ENABLED=true",
    );
  }
  return {
    accessSecret: env.ADMIN_ACCESS_SECRET,
    sessionSecret: env.ADMIN_SESSION_SECRET,
    sessionTtlMs: env.ADMIN_SESSION_TTL_MS,
    webDistDir: env.ADMIN_WEB_DIST_DIR,
  };
}

export function loadManagementEnv(source: NodeJS.ProcessEnv = process.env): ManagementEnv {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const missing = result.error.issues.map(
      (issue) => `- ${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`Configuração de ambiente inválida:\n${missing.join("\n")}`);
  }

  return result.data;
}
