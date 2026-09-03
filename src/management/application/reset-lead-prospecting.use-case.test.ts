import { describe, expect, it, vi } from "vitest";
import { InMemoryLeadRepository } from "../test-support/in-memory-lead-repository.ts";
import { InvalidLeadPhoneError, LeadNotFoundError } from "./errors.ts";
import type { AdminActionEntry } from "./ports/admin-action-audit.port.ts";
import type { Logger } from "./ports/logger.port.ts";
import { ResetLeadProspectingUseCase } from "./reset-lead-prospecting.use-case.ts";

const PHONE = "+5511988887777";

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

class FakeAudit {
  readonly calls: AdminActionEntry[] = [];
  private shouldFail = false;
  failNext(): void {
    this.shouldFail = true;
  }
  record(entry: AdminActionEntry): Promise<void> {
    if (this.shouldFail) {
      this.shouldFail = false;
      return Promise.reject(new Error("auditoria indisponível"));
    }
    this.calls.push(entry);
    return Promise.resolve();
  }
}

function buildHarness() {
  const leads = new InMemoryLeadRepository();
  const audit = new FakeAudit();
  const useCase = new ResetLeadProspectingUseCase({
    leads,
    audit,
    logger: fakeLogger(),
    clock: () => new Date("2026-09-03T15:00:00.000Z"),
  });
  return { leads, audit, useCase };
}

describe("ResetLeadProspectingUseCase", () => {
  it("reset de sent/replied → pending e carimbos limpos, com auditoria reset_prospecting", async () => {
    const { leads, audit, useCase } = buildHarness();
    leads.seed({
      phone: PHONE,
      prospectingState: "replied",
      firstContactWamid: "wamid.1",
      firstContactAt: new Date("2026-09-03T12:00:00.000Z"),
      repliedAt: new Date("2026-09-03T12:30:00.000Z"),
    });

    const lead = await useCase.reset(PHONE);

    expect(lead).toMatchObject({
      prospectingState: "pending",
      firstContactWamid: null,
      firstContactAt: null,
      repliedAt: null,
    });
    expect(audit.calls).toEqual([
      {
        actor: "operator",
        action: "reset_prospecting",
        leadPhone: PHONE,
        occurredAt: new Date("2026-09-03T15:00:00.000Z"),
      },
    ]);
  });

  it("é idempotente sobre um lead já em pending", async () => {
    const { leads, useCase } = buildHarness();
    leads.seed({ phone: PHONE, prospectingState: "pending" });

    const lead = await useCase.reset(PHONE);

    expect(lead.prospectingState).toBe("pending");
  });

  it("lead inexistente → LeadNotFoundError", async () => {
    const { useCase } = buildHarness();
    await expect(useCase.reset(PHONE)).rejects.toBeInstanceOf(LeadNotFoundError);
  });

  it("telefone inválido → InvalidLeadPhoneError", async () => {
    const { useCase } = buildHarness();
    await expect(useCase.reset("11988887777")).rejects.toBeInstanceOf(InvalidLeadPhoneError);
  });

  it("falha de auditoria não desfaz o reset", async () => {
    const { leads, audit, useCase } = buildHarness();
    leads.seed({ phone: PHONE, prospectingState: "sent", firstContactWamid: "wamid.1" });
    audit.failNext();

    const lead = await useCase.reset(PHONE);

    expect(lead.prospectingState).toBe("pending");
    expect(lead.firstContactWamid).toBeNull();
  });
});
