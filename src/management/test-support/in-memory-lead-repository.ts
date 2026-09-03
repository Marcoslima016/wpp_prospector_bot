import type {
  LeadContextInput,
  LeadImportInput,
  LeadImportOutcome,
  LeadQueryPage,
  LeadQueryParams,
  LeadRecord,
  LeadRepositoryPort,
} from "../application/ports/lead-repository.port.ts";

const EMPTY_LEAD: Omit<LeadRecord, "phone"> = {
  displayName: null,
  source: null,
  notes: null,
  company: null,
  segment: null,
  city: null,
  prospectingState: "pending",
  firstContactWamid: null,
  firstContactAt: null,
  repliedAt: null,
  importedAt: null,
};

/** Repositório de leads em memória para os testes de caso de uso da prospecção. */
export class InMemoryLeadRepository implements LeadRepositoryPort {
  private readonly store = new Map<string, LeadRecord>();
  /** Ordem de escrita, para uma ordenação estável na `query` de teste. */
  private seq = 0;
  private readonly order = new Map<string, number>();

  seed(record: Partial<LeadRecord> & { phone: string }): void {
    this.store.set(record.phone, { ...EMPTY_LEAD, ...record });
    if (!this.order.has(record.phone)) this.order.set(record.phone, this.seq++);
  }

  upsert(input: LeadContextInput): Promise<LeadRecord> {
    const existing = this.store.get(input.phone);
    const next: LeadRecord = existing
      ? {
          ...existing,
          displayName: input.displayName ?? existing.displayName,
          source: input.source ?? existing.source,
          notes: input.notes ?? existing.notes,
          company: input.company ?? existing.company,
          segment: input.segment ?? existing.segment,
          city: input.city ?? existing.city,
        }
      : { ...EMPTY_LEAD, phone: input.phone, displayName: input.displayName ?? null, source: input.source ?? null, notes: input.notes ?? null, company: input.company ?? null, segment: input.segment ?? null, city: input.city ?? null };
    this.store.set(input.phone, next);
    if (!this.order.has(input.phone)) this.order.set(input.phone, this.seq++);
    return Promise.resolve({ ...next });
  }

  upsertFromImport(input: LeadImportInput): Promise<LeadImportOutcome> {
    const existing = this.store.get(input.phone);
    const existed = existing !== undefined;
    const base: LeadRecord = existing ?? { ...EMPTY_LEAD, phone: input.phone };
    const next: LeadRecord = {
      ...base,
      displayName: input.displayName !== undefined ? input.displayName : base.displayName,
      source: input.source !== undefined ? input.source : base.source,
      notes: input.notes !== undefined ? input.notes : base.notes,
      company: input.company !== undefined ? input.company : base.company,
      segment: input.segment !== undefined ? input.segment : base.segment,
      city: input.city !== undefined ? input.city : base.city,
      importedAt: new Date(),
    };
    this.store.set(input.phone, next);
    if (!this.order.has(input.phone)) this.order.set(input.phone, this.seq++);
    return Promise.resolve({ lead: { ...next }, existed });
  }

  findByPhone(phone: string): Promise<LeadRecord | null> {
    const found = this.store.get(phone);
    return Promise.resolve(found ? { ...found } : null);
  }

  query(params: LeadQueryParams): Promise<LeadQueryPage> {
    const items = [...this.store.values()].filter((lead) => {
      if (params.state !== undefined && lead.prospectingState !== params.state) return false;
      if (
        params.phoneContains !== undefined &&
        params.phoneContains !== "" &&
        !lead.phone.includes(params.phoneContains)
      ) {
        return false;
      }
      if (params.segment !== undefined && params.segment !== "" && lead.segment !== params.segment) {
        return false;
      }
      return true;
    });

    // Ordenação estável: mais recente primeiro (ordem de escrita como proxy), telefone como desempate.
    items.sort((a, b) => {
      const oa = this.order.get(a.phone) ?? 0;
      const ob = this.order.get(b.phone) ?? 0;
      if (oa !== ob) return ob - oa;
      return a.phone < b.phone ? -1 : a.phone > b.phone ? 1 : 0;
    });

    const start = params.cursor ? Number(Buffer.from(params.cursor, "base64url").toString("utf8")) : 0;
    const slice = items.slice(start, start + params.limit);
    const nextIndex = start + params.limit;
    return Promise.resolve({
      items: slice.map((lead) => ({ ...lead })),
      nextCursor:
        nextIndex < items.length
          ? Buffer.from(String(nextIndex), "utf8").toString("base64url")
          : null,
    });
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

  resetProspecting(phone: string): Promise<boolean> {
    const existing = this.store.get(phone);
    if (existing === undefined) return Promise.resolve(false);
    this.patch(phone, {
      prospectingState: "pending",
      firstContactWamid: null,
      firstContactAt: null,
      repliedAt: null,
    });
    return Promise.resolve(true);
  }

  private patch(phone: string, fields: Partial<LeadRecord>): void {
    const existing = this.store.get(phone);
    if (existing === undefined) return;
    this.store.set(phone, { ...existing, ...fields });
  }
}
