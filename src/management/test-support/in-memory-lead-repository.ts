import type {
  LeadContextInput,
  LeadRecord,
  LeadRepositoryPort,
} from "../application/ports/lead-repository.port.ts";

/** Repositório de leads em memória para os testes de caso de uso da prospecção. */
export class InMemoryLeadRepository implements LeadRepositoryPort {
  private readonly store = new Map<string, LeadRecord>();

  seed(record: Partial<LeadRecord> & { phone: string }): void {
    this.store.set(record.phone, {
      displayName: null,
      source: null,
      notes: null,
      prospectingState: "pending",
      firstContactWamid: null,
      firstContactAt: null,
      repliedAt: null,
      ...record,
    });
  }

  upsert(input: LeadContextInput): Promise<LeadRecord> {
    const existing = this.store.get(input.phone);
    const next: LeadRecord = existing
      ? {
          ...existing,
          displayName: input.displayName ?? existing.displayName,
          source: input.source ?? existing.source,
          notes: input.notes ?? existing.notes,
        }
      : {
          phone: input.phone,
          displayName: input.displayName ?? null,
          source: input.source ?? null,
          notes: input.notes ?? null,
          prospectingState: "pending",
          firstContactWamid: null,
          firstContactAt: null,
          repliedAt: null,
        };
    this.store.set(input.phone, next);
    return Promise.resolve({ ...next });
  }

  findByPhone(phone: string): Promise<LeadRecord | null> {
    const found = this.store.get(phone);
    return Promise.resolve(found ? { ...found } : null);
  }

  markProspected(phone: string, wamid: string, at: Date): Promise<void> {
    this.patch(phone, { prospectingState: "sent", firstContactWamid: wamid, firstContactAt: at });
    return Promise.resolve();
  }

  markFailed(phone: string, _at: Date): Promise<void> {
    this.patch(phone, { prospectingState: "failed" });
    return Promise.resolve();
  }

  markReplied(phone: string, at: Date): Promise<void> {
    const existing = this.store.get(phone);
    if (existing?.prospectingState === "sent") {
      this.patch(phone, { prospectingState: "replied", repliedAt: at });
    }
    return Promise.resolve();
  }

  private patch(phone: string, fields: Partial<LeadRecord>): void {
    const existing = this.store.get(phone);
    if (existing === undefined) return;
    this.store.set(phone, { ...existing, ...fields });
  }
}
