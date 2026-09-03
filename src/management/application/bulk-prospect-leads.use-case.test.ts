import { describe, expect, it, vi } from "vitest";
import { LeadSerialQueue } from "../../conversation-engine/infrastructure/inbound/lead-serial-queue.ts";
import { WhatsAppApiError } from "../../whatsapp-connectivity/application/errors.ts";
import { FakeSendTemplateMessageUseCase } from "../test-support/fake-send-template-message.ts";
import { InMemoryConversationRepository } from "../test-support/in-memory-conversation-repository.ts";
import { InMemoryLeadRepository } from "../test-support/in-memory-lead-repository.ts";
import { BulkProspectLeadsUseCase } from "./bulk-prospect-leads.use-case.ts";
import { LeadBatchTooLargeError } from "./errors.ts";
import type { AdminActionEntry } from "./ports/admin-action-audit.port.ts";
import type { Logger } from "./ports/logger.port.ts";
import { ProspectLeadUseCase } from "./prospect-lead.use-case.ts";

const PENDING = "+5516990000001";
const ALREADY = "+5516990000002";
const NO_LEAD = "+5516990000003";
const GATEWAY_FAIL = "+5516990000004";

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

class RecordingAudit {
  readonly calls: AdminActionEntry[] = [];
  record(entry: AdminActionEntry): Promise<void> {
    this.calls.push(entry);
    return Promise.resolve();
  }
}

function buildHarness() {
  const leads = new InMemoryLeadRepository();
  const conversations = new InMemoryConversationRepository();
  const sendTemplate = new FakeSendTemplateMessageUseCase();
  const audit = new RecordingAudit();
  const prospectLead = new ProspectLeadUseCase({
    leads,
    conversations,
    queue: new LeadSerialQueue(),
    sendTemplate: sendTemplate.asUseCase(),
    template: { name: "abertura_lead_obras", lang: "pt_BR", paramKeys: [] },
    audit,
    logger: fakeLogger(),
    clock: () => new Date("2026-09-03T12:00:00.000Z"),
  });
  const useCase = new BulkProspectLeadsUseCase({ prospectLead, leads });
  return { leads, conversations, sendTemplate, audit, useCase };
}

describe("BulkProspectLeadsUseCase", () => {
  it("desfechos mistos: sent, skipped, failed (sem lead) e failed (gateway)", async () => {
    const { leads, sendTemplate, audit, useCase } = buildHarness();
    leads.seed({ phone: PENDING, prospectingState: "pending" });
    leads.seed({ phone: ALREADY, prospectingState: "sent" });
    leads.seed({ phone: GATEWAY_FAIL, prospectingState: "pending" });

    let call = 0;
    const realExecute = sendTemplate.execute.bind(sendTemplate);
    sendTemplate.execute = (input) => {
      call += 1;
      if (input.to === GATEWAY_FAIL) {
        return Promise.reject(new WhatsAppApiError("Template não aprovado", { code: "132001" }));
      }
      return realExecute(input);
    };

    const { results } = await useCase.prospect({
      phones: [PENDING, ALREADY, NO_LEAD, GATEWAY_FAIL],
    });

    const byPhone = Object.fromEntries(results.map((r) => [r.phone, r]));
    expect(byPhone[PENDING]).toMatchObject({ outcome: "sent" });
    expect(byPhone[PENDING]!.wamid).toBeTruthy();
    expect(byPhone[ALREADY]).toMatchObject({ outcome: "skipped" });
    expect(byPhone[NO_LEAD]).toMatchObject({ outcome: "failed", reason: "lead_not_found", lead: null });
    expect(byPhone[GATEWAY_FAIL]!.outcome).toBe("failed");
    expect(byPhone[GATEWAY_FAIL]!.reason).toContain("gateway");
    expect(byPhone[GATEWAY_FAIL]!.lead).toMatchObject({ prospectingState: "failed" });

    // auditoria só do disparo efetivo (herdada do use-case interno), nenhuma entrada do lote
    expect(audit.calls.map((c) => c.leadPhone)).toEqual([PENDING]);
    expect(call).toBeGreaterThan(0);
  });

  it("a falha de um telefone não interrompe os demais", async () => {
    const { leads, useCase } = buildHarness();
    leads.seed({ phone: PENDING, prospectingState: "pending" });
    leads.seed({ phone: "+5516990000009", prospectingState: "pending" });

    const { results } = await useCase.prospect({ phones: [NO_LEAD, PENDING, "+5516990000009"] });

    expect(results.find((r) => r.phone === NO_LEAD)!.outcome).toBe("failed");
    expect(results.find((r) => r.phone === PENDING)!.outcome).toBe("sent");
    expect(results.find((r) => r.phone === "+5516990000009")!.outcome).toBe("sent");
  });

  it("force reenvia para leads já em sent/replied", async () => {
    const { leads, sendTemplate, useCase } = buildHarness();
    leads.seed({ phone: ALREADY, prospectingState: "sent" });

    const withoutForce = await useCase.prospect({ phones: [ALREADY] });
    expect(withoutForce.results[0]!.outcome).toBe("skipped");
    expect(sendTemplate.calls).toHaveLength(0);

    const withForce = await useCase.prospect({ phones: [ALREADY], force: true });
    expect(withForce.results[0]!.outcome).toBe("sent");
    expect(sendTemplate.calls).toHaveLength(1);
  });

  it("lote acima do limite → erro, nada disparado", async () => {
    const { leads, sendTemplate } = buildHarness();
    const useCase = new BulkProspectLeadsUseCase({
      prospectLead: new ProspectLeadUseCase({
        leads,
        conversations: new InMemoryConversationRepository(),
        queue: new LeadSerialQueue(),
        sendTemplate: sendTemplate.asUseCase(),
        template: { name: "abertura_lead_obras", lang: "pt_BR", paramKeys: [] },
        audit: new RecordingAudit(),
        logger: fakeLogger(),
      }),
      leads,
      maxBatch: 2,
    });

    await expect(
      useCase.prospect({ phones: ["+551", "+552", "+553"] }),
    ).rejects.toBeInstanceOf(LeadBatchTooLargeError);
    expect(sendTemplate.calls).toHaveLength(0);
  });

  it("colapsa telefones duplicados no lote", async () => {
    const { leads, sendTemplate, useCase } = buildHarness();
    leads.seed({ phone: PENDING, prospectingState: "pending" });

    const { results } = await useCase.prospect({ phones: [PENDING, PENDING, PENDING] });

    expect(results).toHaveLength(1);
    expect(sendTemplate.calls).toHaveLength(1);
  });

  it("idempotência vem do use-case interno: segundo disparo sem force vira skipped", async () => {
    const { leads, sendTemplate, useCase } = buildHarness();
    leads.seed({ phone: PENDING, prospectingState: "pending" });

    await useCase.prospect({ phones: [PENDING] });
    const second = await useCase.prospect({ phones: [PENDING] });

    expect(second.results[0]!.outcome).toBe("skipped");
    expect(sendTemplate.calls).toHaveLength(1);
  });
});
