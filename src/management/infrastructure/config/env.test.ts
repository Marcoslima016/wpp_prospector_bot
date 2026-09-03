import { describe, expect, it } from "vitest";
import { loadManagementEnv, resolveAdminConfig } from "./env.ts";

const enabledSource = {
  ADMIN_ACCESS_SECRET: "access-secret",
  ADMIN_SESSION_SECRET: "session-secret",
  PROSPECTING_TEMPLATE_NAME: "prospeccao_primeiro_contato",
};

describe("loadManagementEnv", () => {
  it("aplica os valores padrão quando a superfície está desligada", () => {
    const env = loadManagementEnv({ ADMIN_ENABLED: "false" });

    expect(env).toEqual({
      ADMIN_ENABLED: false,
      ADMIN_SESSION_TTL_MS: 43_200_000,
      ADMIN_WEB_DIST_DIR: "../wpp_prospector_bot_panel/dist",
      PROSPECTING_TEMPLATE_LANG: "pt_BR",
    });
  });

  it("com ADMIN_ENABLED=false dispensa os segredos e o template", () => {
    expect(() => loadManagementEnv({ ADMIN_ENABLED: "false" })).not.toThrow();
  });

  it("liga por padrão e aceita os segredos com os defaults de TTL e dir", () => {
    const env = loadManagementEnv(enabledSource);

    expect(env.ADMIN_ENABLED).toBe(true);
    expect(env.ADMIN_ACCESS_SECRET).toBe("access-secret");
    expect(env.ADMIN_SESSION_SECRET).toBe("session-secret");
    expect(env.ADMIN_SESSION_TTL_MS).toBe(43_200_000);
    expect(env.ADMIN_WEB_DIST_DIR).toBe("../wpp_prospector_bot_panel/dist");
  });

  it("respeita os overrides de TTL e dir do build", () => {
    const env = loadManagementEnv({
      ...enabledSource,
      ADMIN_SESSION_TTL_MS: "3600000",
      ADMIN_WEB_DIST_DIR: "/opt/web/dist",
    });

    expect(env.ADMIN_SESSION_TTL_MS).toBe(3_600_000);
    expect(env.ADMIN_WEB_DIST_DIR).toBe("/opt/web/dist");
  });

  it("falha quando ADMIN_ENABLED=true e falta um segredo", () => {
    expect(() =>
      loadManagementEnv({ ADMIN_ACCESS_SECRET: "só-esse", PROSPECTING_TEMPLATE_NAME: "t" }),
    ).toThrow(/ADMIN_ACCESS_SECRET e ADMIN_SESSION_SECRET são obrigatórios/);
    expect(() => loadManagementEnv({})).toThrow(/obrigatórios quando ADMIN_ENABLED=true/);
  });

  it("falha quando ADMIN_ENABLED=true e falta PROSPECTING_TEMPLATE_NAME", () => {
    const { PROSPECTING_TEMPLATE_NAME: _omit, ...withoutTemplate } = enabledSource;

    expect(() => loadManagementEnv(withoutTemplate)).toThrow(
      /PROSPECTING_TEMPLATE_NAME é obrigatório quando ADMIN_ENABLED=true/,
    );
  });

  it("falha quando ADMIN_SESSION_TTL_MS não é um inteiro positivo", () => {
    expect(() => loadManagementEnv({ ...enabledSource, ADMIN_SESSION_TTL_MS: "abc" })).toThrow(
      /Configuração de ambiente inválida/,
    );
    expect(() => loadManagementEnv({ ...enabledSource, ADMIN_SESSION_TTL_MS: "-5" })).toThrow(
      /Configuração de ambiente inválida/,
    );
  });
});

describe("resolveAdminConfig", () => {
  it("devolve null quando a superfície está desligada", () => {
    expect(resolveAdminConfig(loadManagementEnv({ ADMIN_ENABLED: "false" }))).toBeNull();
  });

  it("devolve os segredos, defaults e o template de primeiro contato quando ligada", () => {
    expect(resolveAdminConfig(loadManagementEnv(enabledSource))).toEqual({
      accessSecret: "access-secret",
      sessionSecret: "session-secret",
      sessionTtlMs: 43_200_000,
      webDistDir: "../wpp_prospector_bot_panel/dist",
      firstContactTemplate: {
        name: "prospeccao_primeiro_contato",
        lang: "pt_BR",
        paramKeys: [],
      },
    });
  });

  it("faz parse do CSV de PROSPECTING_TEMPLATE_PARAM_KEYS e respeita o idioma informado", () => {
    const config = resolveAdminConfig(
      loadManagementEnv({
        ...enabledSource,
        PROSPECTING_TEMPLATE_LANG: "en_US",
        PROSPECTING_TEMPLATE_PARAM_KEYS: "nome, empresa , cidade",
      }),
    );

    expect(config?.firstContactTemplate).toEqual({
      name: "prospeccao_primeiro_contato",
      lang: "en_US",
      paramKeys: ["nome", "empresa", "cidade"],
    });
  });
});
