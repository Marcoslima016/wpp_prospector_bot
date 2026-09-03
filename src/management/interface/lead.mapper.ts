import type { LeadRecord, LeadQueryPage } from "../application/ports/lead-repository.port.ts";
import type { BulkProspectResult } from "../application/bulk-prospect-leads.use-case.ts";
import type { ImportLeadsResult } from "../application/import-leads.use-case.ts";
import type {
  BulkProspectResult as BulkProspectResultDto,
  ImportLeadsResult as ImportLeadsResultDto,
  LeadListPage,
  LeadResource,
} from "./dto/lead.dto.ts";

/** `LeadRecord` (repositório) → `LeadResource` (contrato de resposta). */
export function toLeadResource(lead: LeadRecord): LeadResource {
  return {
    phone: lead.phone,
    displayName: lead.displayName,
    source: lead.source,
    notes: lead.notes,
    company: lead.company,
    segment: lead.segment,
    city: lead.city,
    prospectingState: lead.prospectingState,
    firstContactAt: lead.firstContactAt === null ? null : lead.firstContactAt.toISOString(),
    repliedAt: lead.repliedAt === null ? null : lead.repliedAt.toISOString(),
  };
}

/** `LeadQueryPage` (repositório) → `LeadListPage` (contrato de resposta). */
export function toLeadListPage(page: LeadQueryPage, pageSize: number): LeadListPage {
  return {
    items: page.items.map(toLeadResource),
    pageSize,
    nextCursor: page.nextCursor,
  };
}

/** Resultado da importação (aplicação) → contrato de resposta (já compatível). */
export function toImportLeadsResult(result: ImportLeadsResult): ImportLeadsResultDto {
  return {
    imported: result.imported,
    updated: result.updated,
    rejected: result.rejected.map((r) => ({ row: r.row, phone: r.phone, reason: r.reason })),
  };
}

/** Resultado do disparo em lote (aplicação) → contrato de resposta. */
export function toBulkProspectResult(result: BulkProspectResult): BulkProspectResultDto {
  return {
    results: result.results.map((item) => ({
      phone: item.phone,
      outcome: item.outcome,
      ...(item.wamid !== undefined ? { wamid: item.wamid } : {}),
      ...(item.reason !== undefined ? { reason: item.reason } : {}),
      lead: item.lead === null ? null : toLeadResource(item.lead),
    })),
  };
}
