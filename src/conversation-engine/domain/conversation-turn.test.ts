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
