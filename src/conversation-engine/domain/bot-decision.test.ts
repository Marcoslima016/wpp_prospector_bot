import { describe, expect, it } from "vitest";
import { BotDecision, BOT_DECISION_JSON_SCHEMA } from "./bot-decision.ts";
import { DomainValidationError } from "./errors.ts";

const base = {
  replyMessages: [] as string[],
  endConversation: false,
  leadIntent: "unknown" as const,
  leadQualification: null,
  handoffToHuman: false,
  reasoning: null,
};

describe("BotDecision.create", () => {
  it("aceita uma decisão sem mensagens de resposta (não responde)", () => {
    const decision = BotDecision.create({ ...base, replyMessages: [] });

    expect(decision.replyMessages).toEqual([]);
    expect(decision.shouldReply).toBe(false);
  });

  it("aceita uma decisão com uma única mensagem de resposta", () => {
    const decision = BotDecision.create({
      ...base,
      replyMessages: ["Olá! Posso te contar mais sobre a oferta?"],
      leadIntent: "interested",
      leadQualification: "warm",
    });

    expect(decision.replyMessages).toHaveLength(1);
    expect(decision.shouldReply).toBe(true);
    expect(decision.leadQualification).toBe("warm");
  });

  it("aceita uma decisão com múltiplas mensagens de resposta na ordem informada", () => {
    const decision = BotDecision.create({
      ...base,
      replyMessages: ["Primeiro ponto", "Segundo ponto", "Terceiro ponto"],
    });

    expect(decision.replyMessages).toEqual(["Primeiro ponto", "Segundo ponto", "Terceiro ponto"]);
  });

  it("rejeita leadIntent fora do conjunto permitido", () => {
    expect(() => BotDecision.create({ ...base, leadIntent: "curioso" as never })).toThrow(
      DomainValidationError,
    );
  });

  it("rejeita leadQualification fora do conjunto permitido", () => {
    expect(() => BotDecision.create({ ...base, leadQualification: "morno" as never })).toThrow(
      DomainValidationError,
    );
  });

  it("rejeita tipos errados nos campos booleanos", () => {
    expect(() => BotDecision.create({ ...base, endConversation: "sim" as never })).toThrow(
      DomainValidationError,
    );
  });

  it("rejeita mensagens de resposta vazias", () => {
    expect(() => BotDecision.create({ ...base, replyMessages: [""] })).toThrow(
      DomainValidationError,
    );
  });

  it("aplica defaults retrocompatíveis para os campos de módulos/plano quando ausentes", () => {
    const decision = BotDecision.create({ ...base });

    expect(decision.recommendedModules).toEqual([]);
    expect(decision.interestedModules).toEqual([]);
    expect(decision.quotedPlan).toBeNull();
  });

  it("aceita módulos ofertados/de interesse e o plano citado", () => {
    const decision = BotDecision.create({
      ...base,
      recommendedModules: ["gestao-obras", "obra360"],
      interestedModules: ["gestao-obras"],
      quotedPlan: "essencial",
    });

    expect(decision.recommendedModules).toEqual(["gestao-obras", "obra360"]);
    expect(decision.interestedModules).toEqual(["gestao-obras"]);
    expect(decision.quotedPlan).toBe("essencial");
  });

  it("rejeita id de módulo fora do catálogo", () => {
    expect(() =>
      BotDecision.create({ ...base, recommendedModules: ["modulo-inexistente" as never] }),
    ).toThrow(DomainValidationError);
  });

  it("rejeita quotedPlan fora do conjunto permitido", () => {
    expect(() => BotDecision.create({ ...base, quotedPlan: "completo" as never })).toThrow(
      DomainValidationError,
    );
  });

  it("expõe um JSON Schema com todos os campos obrigatórios", () => {
    expect(BOT_DECISION_JSON_SCHEMA.required).toEqual([
      "replyMessages",
      "endConversation",
      "leadIntent",
      "leadQualification",
      "handoffToHuman",
      "reasoning",
      "recommendedModules",
      "interestedModules",
      "quotedPlan",
    ]);
    expect(BOT_DECISION_JSON_SCHEMA.additionalProperties).toBe(false);
  });

  it("usa apenas o subconjunto de JSON Schema aceito pela Anthropic (sem type-array, sem minLength/maxLength)", () => {
    const serialized = JSON.stringify(BOT_DECISION_JSON_SCHEMA);

    // `type` nunca deve ser um array (nullable é expresso via anyOf + {type:"null"})
    expect(serialized).not.toMatch(/"type"\s*:\s*\[/);
    expect(serialized).not.toContain("minLength");
    expect(serialized).not.toContain("maxLength");

    // campos nullable expressos via anyOf
    expect(BOT_DECISION_JSON_SCHEMA.properties.leadQualification).toEqual({
      anyOf: [{ type: "string", enum: ["hot", "warm", "cold"] }, { type: "null" }],
      description: expect.any(String),
    });
    expect(BOT_DECISION_JSON_SCHEMA.properties.reasoning).toEqual({
      anyOf: [{ type: "string" }, { type: "null" }],
      description: expect.any(String),
    });
  });
});
