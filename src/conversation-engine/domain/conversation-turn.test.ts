import { describe, expect, it } from "vitest";
import { ConversationTurn } from "./conversation-turn.ts";

const t0 = new Date("2026-08-27T12:00:00.000Z");

describe("ConversationTurn — origem do turno outbound", () => {
  it("um turno outbound do bot tem origin `bot` por padrão", () => {
    const turn = ConversationTurn.outbound({
      text: "olá!",
      timestamp: t0,
      leadIntent: "interested",
      leadQualification: "warm",
      reasoning: null,
      recommendedModules: [],
      interestedModules: [],
      quotedPlan: null,
    });

    expect(turn.origin).toBe("bot");
    expect(turn.toJSON().origin).toBe("bot");
  });

  it("manualOutbound cria um turno outbound com origin `operator` e sem metadados de decisão", () => {
    const turn = ConversationTurn.manualOutbound({ text: "oi, aqui é o time", timestamp: t0 });

    expect(turn.direction).toBe("outbound");
    expect(turn.origin).toBe("operator");
    expect(turn.leadIntent).toBeUndefined();
    expect(turn.quotedPlan).toBeNull();
    expect(turn.toJSON().origin).toBe("operator");
  });

  it("round-trip toJSON/fromJSON preserva origin `operator`", () => {
    const turn = ConversationTurn.manualOutbound({ text: "mensagem do operador", timestamp: t0 });

    const restored = ConversationTurn.fromJSON(JSON.parse(JSON.stringify(turn.toJSON())));

    expect(restored.origin).toBe("operator");
  });

  it("turno outbound serializado sem `origin` (antes desta mudança) volta como `bot`", () => {
    const legacy = {
      direction: "outbound" as const,
      text: "Olá! Como posso ajudar?",
      timestamp: t0.toISOString(),
      leadIntent: "interested" as const,
      leadQualification: "warm" as const,
      reasoning: null,
    };

    const restored = ConversationTurn.fromJSON(legacy);

    expect(restored.origin).toBe("bot");
  });

  it("turnos inbound não têm origin", () => {
    const turn = ConversationTurn.inbound({ text: "oi", timestamp: t0, messageId: "wamid.1" });

    expect(turn.origin).toBeUndefined();
    expect(turn.toJSON().origin).toBeUndefined();
  });
});

describe("ConversationTurn — kind do turno outbound de operador", () => {
  it("manualOutbound tem kind `manual` por padrão e não serializa o campo", () => {
    const turn = ConversationTurn.manualOutbound({ text: "oi", timestamp: t0 });

    expect(turn.kind).toBe("manual");
    expect(turn.toJSON().kind).toBeUndefined();
  });

  it("prospectingOutbound cria um turno de operador com kind `prospecting`", () => {
    const turn = ConversationTurn.prospectingOutbound({ text: "template olá", timestamp: t0 });

    expect(turn.direction).toBe("outbound");
    expect(turn.origin).toBe("operator");
    expect(turn.kind).toBe("prospecting");
    expect(turn.toJSON().kind).toBe("prospecting");
  });

  it("round-trip toJSON/fromJSON preserva kind `prospecting`", () => {
    const turn = ConversationTurn.prospectingOutbound({ text: "template olá", timestamp: t0 });

    const restored = ConversationTurn.fromJSON(JSON.parse(JSON.stringify(turn.toJSON())));

    expect(restored.kind).toBe("prospecting");
  });

  it("turno de operador serializado sem `kind` (antes desta mudança) volta como `manual`", () => {
    const legacy = {
      direction: "outbound" as const,
      text: "Oi, aqui é o time",
      timestamp: t0.toISOString(),
      origin: "operator" as const,
    };

    const restored = ConversationTurn.fromJSON(legacy);

    expect(restored.kind).toBe("manual");
  });

  it("turnos do bot e inbound não têm kind", () => {
    const bot = ConversationTurn.outbound({
      text: "olá!",
      timestamp: t0,
      leadIntent: "interested",
      leadQualification: "warm",
      reasoning: null,
      recommendedModules: [],
      interestedModules: [],
      quotedPlan: null,
    });
    const inbound = ConversationTurn.inbound({ text: "oi", timestamp: t0, messageId: "wamid.1" });

    expect(bot.kind).toBeUndefined();
    expect(inbound.kind).toBeUndefined();
  });
});
