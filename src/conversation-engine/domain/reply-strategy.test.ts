import { describe, expect, it } from "vitest";
import { BotDecision } from "./bot-decision.ts";
import { Conversation } from "./conversation.ts";
import { ReplyStrategy } from "./reply-strategy.ts";

const t0 = new Date("2026-08-27T12:00:00.000Z");

function strategy(historyTurns = 20): ReplyStrategy {
  return new ReplyStrategy({
    promptText: "PROMPT DE PROSPECÇÃO",
    model: "claude-sonnet-5",
    historyTurns,
  });
}

describe("ReplyStrategy.buildRequest", () => {
  it("inclui o system prompt e o modelo configurados", () => {
    const conversation = Conversation.createNew("+5511999999999");

    const request = strategy().buildRequest(conversation, ["olá"]);

    expect(request.system).toBe("PROMPT DE PROSPECÇÃO");
    expect(request.model).toBe("claude-sonnet-5");
    expect(request.responseSchema).toBeDefined();
  });

  it("inclui no máximo N turnos recentes do histórico", () => {
    const conversation = Conversation.createNew("+5511999999999");
    for (let i = 0; i < 10; i++) {
      conversation.recordInboundTurn({ text: `msg ${i}`, timestamp: t0, messageId: `wamid.${i}` });
      conversation.applyDecision(
        BotDecision.create({
          replyMessages: [`resposta ${i}`],
          endConversation: false,
          leadIntent: "unknown",
          leadQualification: null,
          handoffToHuman: false,
          reasoning: null,
        }),
        t0,
      );
    }

    const request = strategy(4).buildRequest(conversation, ["nova mensagem"]);

    // 4 turnos de histórico + 1 mensagem nova do lote
    expect(request.messages).toHaveLength(5);
    expect(request.messages.at(-1)).toEqual({ role: "user", content: "nova mensagem" });
  });

  it("inclui todas as mensagens do lote, mesmo além do corte de histórico", () => {
    const conversation = Conversation.createNew("+5511999999999");

    const batch = ["ponto um", "ponto dois", "ponto três"];
    const request = strategy(0).buildRequest(conversation, batch);

    expect(request.messages).toEqual([
      { role: "user", content: "ponto um" },
      { role: "user", content: "ponto dois" },
      { role: "user", content: "ponto três" },
    ]);
  });

  it("não duplica os turnos inbound pendentes que estão sendo processados", () => {
    const conversation = Conversation.createNew("+5511999999999");
    conversation.recordInboundTurn({ text: "pendente", timestamp: t0, messageId: "wamid.1" });

    const request = strategy().buildRequest(conversation, ["pendente"]);

    expect(request.messages).toEqual([{ role: "user", content: "pendente" }]);
  });

  it("mapeia turnos outbound como assistant e inbound como user", () => {
    const conversation = Conversation.createNew("+5511999999999");
    conversation.recordInboundTurn({ text: "oi", timestamp: t0, messageId: "wamid.1" });
    conversation.applyDecision(
      BotDecision.create({
        replyMessages: ["olá, tudo bem?"],
        endConversation: false,
        leadIntent: "unknown",
        leadQualification: null,
        handoffToHuman: false,
        reasoning: null,
      }),
      t0,
    );

    const request = strategy().buildRequest(conversation, ["quero saber o preço"]);

    expect(request.messages).toEqual([
      { role: "user", content: "oi" },
      { role: "assistant", content: "olá, tudo bem?" },
      { role: "user", content: "quero saber o preço" },
    ]);
  });
});
