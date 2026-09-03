import {
  FirstContactTemplateNotConfiguredError,
  InvalidLeadPhoneError,
  LeadBatchTooLargeError,
  LeadNotFoundError,
  ProspectingGatewayError,
} from "./errors.ts";
import { MAX_PROSPECT_BATCH, PROSPECT_CONCURRENCY } from "./lead-batch-limits.ts";
import type { LeadRecord, LeadRepositoryPort } from "./ports/lead-repository.port.ts";
import type { ProspectLeadUseCase } from "./prospect-lead.use-case.ts";

export interface BulkProspectInput {
  phones: string[];
  force?: boolean | undefined;
}

export type BulkProspectOutcome = "sent" | "skipped" | "failed";

export interface BulkProspectResultItem {
  phone: string;
  outcome: BulkProspectOutcome;
  wamid?: string | null;
  reason?: string;
  /** O lead após o disparo; `null` quando não há lead cadastrado para o telefone. */
  lead: LeadRecord | null;
}

export interface BulkProspectResult {
  results: BulkProspectResultItem[];
}

export interface BulkProspectLeadsUseCaseDeps {
  prospectLead: ProspectLeadUseCase;
  leads: LeadRepositoryPort;
  maxBatch?: number;
  concurrency?: number;
}

/** Traduz um erro conhecido do disparo individual para um motivo estável. */
function reasonFor(error: unknown): string {
  if (error instanceof InvalidLeadPhoneError) return "invalid_phone";
  if (error instanceof LeadNotFoundError) return "lead_not_found";
  if (error instanceof FirstContactTemplateNotConfiguredError) {
    return "first_contact_template_not_configured";
  }
  if (error instanceof ProspectingGatewayError) return `gateway: ${error.reason}`;
  return error instanceof Error ? error.message : String(error);
}

/**
 * Dispara o primeiro contato de prospecção para uma lista de telefones reusando
 * integralmente o `ProspectLeadUseCase` (envio, semeadura, idempotência,
 * auditoria por disparo). **Continue-on-error**: a falha de um telefone não
 * interrompe os demais. A serialização por lead vem da `LeadSerialQueue` do
 * use-case interno; aqui só limitamos a concorrência entre telefones distintos
 * para não martelar a Cloud API. O lote não gera entrada de auditoria própria.
 */
export class BulkProspectLeadsUseCase {
  private readonly prospectLead: ProspectLeadUseCase;
  private readonly leads: LeadRepositoryPort;
  private readonly maxBatch: number;
  private readonly concurrency: number;

  constructor(deps: BulkProspectLeadsUseCaseDeps) {
    this.prospectLead = deps.prospectLead;
    this.leads = deps.leads;
    this.maxBatch = deps.maxBatch ?? MAX_PROSPECT_BATCH;
    this.concurrency = Math.max(1, deps.concurrency ?? PROSPECT_CONCURRENCY);
  }

  async prospect(input: BulkProspectInput): Promise<BulkProspectResult> {
    if (input.phones.length > this.maxBatch) {
      throw new LeadBatchTooLargeError(input.phones.length, this.maxBatch);
    }

    // Colapsa duplicados preservando a ordem da primeira ocorrência.
    const phones = [...new Set(input.phones)];
    const results: BulkProspectResultItem[] = new Array(phones.length);

    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < phones.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await this.runOne(phones[index]!, input.force);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(this.concurrency, phones.length) }, () => worker()),
    );

    return { results };
  }

  private async runOne(phone: string, force: boolean | undefined): Promise<BulkProspectResultItem> {
    try {
      const outcome = await this.prospectLead.prospect(phone, { force });
      if (outcome.alreadyProspected) {
        return { phone, outcome: "skipped", lead: outcome.lead };
      }
      return { phone, outcome: "sent", wamid: outcome.wamid, lead: outcome.lead };
    } catch (error) {
      const lead = await this.leads.findByPhone(phone).catch(() => null);
      return { phone, outcome: "failed", reason: reasonFor(error), lead };
    }
  }
}
