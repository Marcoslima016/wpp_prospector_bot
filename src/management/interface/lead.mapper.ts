import type { LeadRecord } from "../application/ports/lead-repository.port.ts";
import type { LeadResource } from "./dto/lead.dto.ts";

/** `LeadRecord` (repositório) → `LeadResource` (contrato de resposta). */
export function toLeadResource(lead: LeadRecord): LeadResource {
  return {
    phone: lead.phone,
    displayName: lead.displayName,
    source: lead.source,
    notes: lead.notes,
    prospectingState: lead.prospectingState,
    firstContactAt: lead.firstContactAt === null ? null : lead.firstContactAt.toISOString(),
    repliedAt: lead.repliedAt === null ? null : lead.repliedAt.toISOString(),
  };
}
