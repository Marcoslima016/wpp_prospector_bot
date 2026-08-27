import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BotDecision } from "../../domain/bot-decision.ts";
import { Conversation } from "../../domain/conversation.ts";
import { FileConversationRepository } from "./file-conversation-repository.ts";

const t0 = new Date("2026-08-27T12:00:00.000Z");

function reply(messages: string[]): BotDecision {
  return BotDecision.create({
    replyMessages: messages,
    endConversation: false,
    leadIntent: "interested",
    leadQualification: "warm",
    handoffToHuman: false,
    reasoning: null,
  });
}

let dir: string;
let repo: FileConversationRepository;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "conv-repo-"));
  repo = new FileConversationRepository(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("FileConversationRepository", () => {
  it("retorna null quando o lead ainda não tem conversa", async () => {
    expect(await repo.load("+5511999999999")).toBeNull();
  });

  it("faz round-trip de load/save preservando turnos, status e dedup", async () => {
    const conversation = Conversation.createNew("+5511999999999");
    conversation.recordInboundTurn({ text: "oi", timestamp: t0, messageId: "wamid.1" });
    conversation.applyDecision(reply(["Olá!"]), t0);
    await repo.save(conversation);

    const loaded = await repo.load("+5511999999999");

    expect(loaded).not.toBeNull();
    expect(loaded!.leadPhone).toBe("+5511999999999");
    expect(loaded!.leadIntent).toBe("interested");
    expect(loaded!.turns).toHaveLength(2);
    expect(loaded!.hasProcessed("wamid.1")).toBe(true);
  });

  it("findConversationsWithPendingInbound retorna só as conversas com turno pendente", async () => {
    const withPending = Conversation.createNew("+5511111111111");
    withPending.recordInboundTurn({ text: "pendente", timestamp: t0, messageId: "wamid.p" });
    await repo.save(withPending);

    const answered = Conversation.createNew("+5522222222222");
    answered.recordInboundTurn({ text: "respondida", timestamp: t0, messageId: "wamid.a" });
    answered.applyDecision(reply(["ok"]), t0);
    await repo.save(answered);

    const pending = await repo.findConversationsWithPendingInbound();

    expect(pending.map((c) => c.leadPhone)).toEqual(["+5511111111111"]);
  });

  it("retorna lista vazia quando o diretório ainda não existe", async () => {
    const missing = new FileConversationRepository(join(dir, "ainda-nao-existe"));
    expect(await missing.findConversationsWithPendingInbound()).toEqual([]);
  });

  it("escritas sequenciais para o mesmo lead não corrompem o arquivo", async () => {
    const conversation = Conversation.createNew("+5511999999999");

    for (let i = 0; i < 20; i++) {
      conversation.recordInboundTurn({ text: `msg ${i}`, timestamp: t0, messageId: `wamid.${i}` });
      await repo.save(conversation);
    }

    const loaded = await repo.load("+5511999999999");
    expect(loaded!.turns).toHaveLength(20);
  });

  it("save cria o diretório de conversas se ele não existir", async () => {
    const nested = new FileConversationRepository(join(dir, "a", "b", "c"));
    const conversation = Conversation.createNew("+5511999999999");
    conversation.recordInboundTurn({ text: "oi", timestamp: t0, messageId: "wamid.1" });

    await expect(nested.save(conversation)).resolves.not.toThrow();
    expect(await nested.load("+5511999999999")).not.toBeNull();
  });
});
