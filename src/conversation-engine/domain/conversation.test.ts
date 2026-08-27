import { describe, expect, it } from "vitest";
import { BotDecision, type BotDecisionInput } from "./bot-decision.ts";
import { Conversation } from "./conversation.ts";

function decision(overrides: Partial<BotDecisionInput> = {}): BotDecision {
  return BotDecision.create({
    replyMessages: [],
    endConversation: false,
    leadIntent: "unknown",
    leadQualification: null,
    handoffToHuman: false,
    reasoning: null,
    ...overrides,
  });
}

const t0 = new Date("2026-08-27T12:00:00.000Z");

describe("Conversation", () => {
  it("deduplica mensagens inbound pelo messageId", () => {
    const conversation = Conversation.createNew("+5511999999999");

    conversation.recordInboundTurn({ text: "oi", timestamp: t0, messageId: "wamid.1" });
    conversation.recordInboundTurn({ text: "oi de novo", timestamp: t0, messageId: "wamid.1" });

    expect(conversation.hasProcessed("wamid.1")).toBe(true);
    expect(conversation.turns).toHaveLength(1);
  });

  it("aplica uma decisão com resposta: adiciona turnos outbound e atualiza o status do lead", () => {
    const conversation = Conversation.createNew("+5511999999999");
    conversation.recordInboundTurn({ text: "quero saber mais", timestamp: t0, messageId: "wamid.1" });

    conversation.applyDecision(
      decision({
        replyMessages: ["Claro!", "Temos plano mensal e anual."],
        leadIntent: "interested",
        leadQualification: "warm",
      }),
      t0,
    );

    const outbound = conversation.turns.filter((turn) => turn.direction === "outbound");
    expect(outbound.map((turn) => turn.text)).toEqual(["Claro!", "Temos plano mensal e anual."]);
    expect(conversation.leadIntent).toBe("interested");
    expect(conversation.leadQualification).toBe("warm");
    expect(conversation.pendingInboundTurns).toHaveLength(0);
  });

  it("aplica uma decisão sem resposta: nenhum turno outbound, mas o status é atualizado", () => {
    const conversation = Conversation.createNew("+5511999999999");
    conversation.recordInboundTurn({ text: "...", timestamp: t0, messageId: "wamid.1" });

    conversation.applyDecision(decision({ replyMessages: [], leadIntent: "off_topic" }), t0);

    expect(conversation.turns.filter((turn) => turn.direction === "outbound")).toHaveLength(0);
    expect(conversation.leadIntent).toBe("off_topic");
    expect(conversation.pendingInboundTurns).toHaveLength(0);
  });

  it("reabre automaticamente uma conversa encerrada no próximo inbound", () => {
    const conversation = Conversation.createNew("+5511999999999");
    conversation.recordInboundTurn({ text: "tchau", timestamp: t0, messageId: "wamid.1" });
    conversation.applyDecision(decision({ endConversation: true, replyMessages: ["Até mais!"] }), t0);
    expect(conversation.state).toBe("ended");

    conversation.reopenIfEnded();

    expect(conversation.state).toBe("active");
  });

  it("não reabre uma conversa que está aguardando atendimento humano", () => {
    const conversation = Conversation.createNew("+5511999999999");
    conversation.recordInboundTurn({ text: "quero falar com alguém", timestamp: t0, messageId: "wamid.1" });
    conversation.applyDecision(
      decision({ handoffToHuman: true, replyMessages: ["Vou te transferir."] }),
      t0,
    );
    expect(conversation.state).toBe("awaitingHuman");
    expect(conversation.acceptsAutomatedReplies).toBe(false);

    conversation.reopenIfEnded();

    expect(conversation.state).toBe("awaitingHuman");
  });

  it("marca turnos inbound pendentes como abandonados", () => {
    const conversation = Conversation.createNew("+5511999999999");
    conversation.recordInboundTurn({ text: "a", timestamp: t0, messageId: "wamid.1" });
    conversation.recordInboundTurn({ text: "b", timestamp: t0, messageId: "wamid.2" });

    conversation.markPendingAbandoned();

    expect(conversation.pendingInboundTurns).toHaveLength(0);
    expect(conversation.turns.every((turn) => turn.abandoned)).toBe(true);
  });

  it("recentTurns corta pelo número de turnos mais recentes", () => {
    const conversation = Conversation.createNew("+5511999999999");
    for (let i = 0; i < 5; i++) {
      conversation.recordInboundTurn({ text: `msg ${i}`, timestamp: t0, messageId: `wamid.${i}` });
    }

    const recent = conversation.recentTurns(2);

    expect(recent.map((turn) => turn.text)).toEqual(["msg 3", "msg 4"]);
    expect(conversation.recentTurns(0)).toEqual([]);
  });

  it("faz round-trip de serialização preservando estado e dedup", () => {
    const conversation = Conversation.createNew("+5511999999999");
    conversation.recordInboundTurn({ text: "oi", timestamp: t0, messageId: "wamid.1" });
    conversation.applyDecision(decision({ replyMessages: ["Olá!"], leadIntent: "interested" }), t0);

    const restored = Conversation.fromJSON(JSON.parse(JSON.stringify(conversation.toJSON())));

    expect(restored.leadPhone).toBe("+5511999999999");
    expect(restored.leadIntent).toBe("interested");
    expect(restored.hasProcessed("wamid.1")).toBe(true);
    expect(restored.turns).toHaveLength(2);
  });
});
