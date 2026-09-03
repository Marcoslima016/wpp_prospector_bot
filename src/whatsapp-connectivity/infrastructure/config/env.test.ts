import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.ts";

const REQUIRED = {
  META_ACCESS_TOKEN: "tok",
  META_APP_SECRET: "sec",
  META_PHONE_NUMBER_ID: "pn",
  META_WABA_ID: "waba",
  META_WEBHOOK_VERIFY_TOKEN: "vt",
};

describe("loadEnv — rastreio de custo de mensageria WhatsApp", () => {
  it("default: tracking ligado e país-base BR", () => {
    const env = loadEnv({ ...REQUIRED });

    expect(env.WHATSAPP_COST_TRACKING_ENABLED).toBe(true);
    expect(env.WHATSAPP_BILLING_COUNTRY).toBe("BR");
  });

  it('WHATSAPP_COST_TRACKING_ENABLED="false" desliga', () => {
    const env = loadEnv({ ...REQUIRED, WHATSAPP_COST_TRACKING_ENABLED: "false" });

    expect(env.WHATSAPP_COST_TRACKING_ENABLED).toBe(false);
  });

  it("normaliza a caixa do país-base", () => {
    const env = loadEnv({ ...REQUIRED, WHATSAPP_BILLING_COUNTRY: "us" });

    expect(env.WHATSAPP_BILLING_COUNTRY).toBe("US");
  });

  it("país-base com ≠ 2 letras falha no load", () => {
    expect(() => loadEnv({ ...REQUIRED, WHATSAPP_BILLING_COUNTRY: "BRA" })).toThrow(
      /WHATSAPP_BILLING_COUNTRY/,
    );
  });

  it("valor não booleano em WHATSAPP_COST_TRACKING_ENABLED falha no load", () => {
    expect(() => loadEnv({ ...REQUIRED, WHATSAPP_COST_TRACKING_ENABLED: "sim" })).toThrow(
      /Configuração de ambiente inválida/,
    );
  });
});
