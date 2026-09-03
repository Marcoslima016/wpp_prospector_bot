import { z } from "zod";
import type { FirstContactTemplateConfig } from "../../application/first-contact-template.ts";

/** `"a, b ,c"` → `["a", "b", "c"]`; vazio/ausente → `[]`. */
function parseCsv(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

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
    // Nome do template aprovado usado como primeiro contato de prospecção
    // (`POST /admin/api/leads/:leadPhone/prospect`). Obrigatório quando `ADMIN_ENABLED=true`.
    PROSPECTING_TEMPLATE_NAME: z.string().min(1).optional(),
    // Idioma do template de primeiro contato (código BCP-47 aceito pela Cloud API).
    PROSPECTING_TEMPLATE_LANG: z.string().min(1).default("pt_BR"),
    // Nomes ordenados dos parâmetros do template, separados por vírgula. Dão a
    // ordem posicional ao mapear um objeto `{ nome: valor }` do corpo do disparo.
    PROSPECTING_TEMPLATE_PARAM_KEYS: z.string().optional(),
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
  )
  .refine((value) => !value.ADMIN_ENABLED || value.PROSPECTING_TEMPLATE_NAME !== undefined, {
    error: "PROSPECTING_TEMPLATE_NAME é obrigatório quando ADMIN_ENABLED=true",
    path: ["PROSPECTING_TEMPLATE_NAME"],
  });

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
  /** Template aprovado do primeiro contato de prospecção. */
  firstContactTemplate: FirstContactTemplateConfig;
}

/**
 * `null` quando `ADMIN_ENABLED=false` — o caller não deve registrar o plugin
 * `/admin` nem embrulhar o repositório com a projeção.
 */
export function resolveAdminConfig(env: ManagementEnv): ResolvedAdminConfig | null {
  if (!env.ADMIN_ENABLED) return null;
  if (
    env.ADMIN_ACCESS_SECRET === undefined ||
    env.ADMIN_SESSION_SECRET === undefined ||
    env.PROSPECTING_TEMPLATE_NAME === undefined
  ) {
    // Inalcançável: os `refine` do schema já falham o parse. Guardado para o type-narrowing.
    throw new Error(
      "Configuração /admin inconsistente: segredos ou template de prospecção ausentes com ADMIN_ENABLED=true",
    );
  }
  return {
    accessSecret: env.ADMIN_ACCESS_SECRET,
    sessionSecret: env.ADMIN_SESSION_SECRET,
    sessionTtlMs: env.ADMIN_SESSION_TTL_MS,
    webDistDir: env.ADMIN_WEB_DIST_DIR,
    firstContactTemplate: {
      name: env.PROSPECTING_TEMPLATE_NAME,
      lang: env.PROSPECTING_TEMPLATE_LANG,
      paramKeys: parseCsv(env.PROSPECTING_TEMPLATE_PARAM_KEYS),
    },
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
