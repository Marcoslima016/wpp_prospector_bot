import { describe, expect, it, vi } from "vitest";
import { Conversation } from "../../../conversation-engine/domain/conversation.ts";
import type { Logger } from "../../application/ports/logger.port.ts";
import { buildConversation } from "../../test-support/conversation-fixtures.ts";
import { InMemoryConversationRepository } from "../../test-support/in-memory-conversation-repository.ts";
import { InMemoryLeadRepository } from "../../test-support/in-memory-lead-repository.ts";
import { ProspectingReplyTracker } from "./prospecting-reply-tracker.ts";

const PHONE = "+5511988887777";
const NOW = new Date("2026-09-03T12:30:00.000Z");

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function build(): {
  inner: InMemoryConversationRepository;
  leads: InMemoryLeadRepository;
  logger: Logger;
  tracker: ProspectingReplyTracker;
} {
  const inner = new InMemoryConversationRepository();
  const leads = new InMemoryLeadRepository();
  const logger = fakeLogger();
  const tracker = new ProspectingReplyTracker(inner, leads, logger, () => NOW);
  return { inner, leads, logger, tracker };
}

describe("ProspectingReplyTracker", () => {
  it("promove um lead em sent para replied quando a conversa salva já tem inbound", async () => {
    const { leads, tracker } = build();
    leads.seed({ phone: PHONE, prospectingState: "sent", firstContactWamid: "wamid.1" });

    await tracker.save(buildConversation({ leadPhone: PHONE }));

    const lead = await leads.findByPhone(PHONE);
    expect(lead).toMatchObject({ prospectingState: "replied", repliedAt: NOW });
  });

  it("não chama markReplied quando a conversa não tem turno inbound", async () => {
    const { leads, tracker } = build();
    leads.seed({ phone: PHONE, prospectingState: "sent" });
    const markReplied = vi.spyOn(leads, "markReplied");

    const conversation = Conversation.createNew(PHONE);
    conversation.recordProspectingOutboundTurn("[primeiro contato]", NOW);
    await tracker.save(conversation);

    expect(markReplied).not.toHaveBeenCalled();
    expect((await leads.findByPhone(PHONE))!.prospectingState).toBe("sent");
  });

  it("é no-op quando não há lead para o telefone", async () => {
    const { leads, tracker } = build();
    const markReplied = vi.spyOn(leads, "markReplied");

    await tracker.save(buildConversation({ leadPhone: PHONE }));

    expect(markReplied).not.toHaveBeenCalled();
  });

  it("é no-op quando o lead está fora do estado sent", async () => {
    const { leads, tracker } = build();
    leads.seed({ phone: PHONE, prospectingState: "pending" });

    await tracker.save(buildConversation({ leadPhone: PHONE }));

    expect((await leads.findByPhone(PHONE))!.prospectingState).toBe("pending");
  });

  it("uma falha ao marcar replied é logada e não propaga (o save conclui)", async () => {
    const { leads, logger, tracker } = build();
    leads.seed({ phone: PHONE, prospectingState: "sent" });
    vi.spyOn(leads, "markReplied").mockRejectedValueOnce(new Error("db down"));

    await expect(tracker.save(buildConversation({ leadPhone: PHONE }))).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("delega load e findConversationsWithPendingInbound ao repositório interno", async () => {
    const { inner, tracker } = build();
    await inner.save(buildConversation({ leadPhone: PHONE, pendingInbound: true }));

    expect(await tracker.load(PHONE)).not.toBeNull();
    expect(await tracker.findConversationsWithPendingInbound()).toHaveLength(1);
  });
});
