import { normalizeBrazilPhone } from "../../whatsapp-connectivity/domain/brazil-phone.ts";
import { LeadBatchTooLargeError } from "./errors.ts";
import { MAX_IMPORT_ROWS } from "./lead-batch-limits.ts";
import type { LeadImportInput, LeadRepositoryPort } from "./ports/lead-repository.port.ts";

/** Um item do lote de importação, já extraído pelo cliente. */
export interface ImportLeadItem {
  phone: string;
  displayName?: string | undefined;
  source?: string | undefined;
  notes?: string | undefined;
  company?: string | undefined;
  segment?: string | undefined;
  city?: string | undefined;
}

export interface ImportLeadsInput {
  leads: ImportLeadItem[];
}

/** Uma linha rejeitada: a linha de origem no lote (índice 0-based), o telefone recebido e o motivo. */
export interface ImportRejectedRow {
  row: number;
  phone: string;
  reason: string;
}

export interface ImportLeadsResult {
  imported: number;
  updated: number;
  rejected: ImportRejectedRow[];
}

export interface ImportLeadsUseCaseDeps {
  leads: LeadRepositoryPort;
  maxRows?: number;
}

/**
 * Importa um lote de leads sem disparar nada. Revalida cada telefone contra a
 * regra E.164 brasileira (o cliente não é fonte da verdade), acumula rejeitados
 * com a linha de origem, colapsa telefones repetidos (última ocorrência vence) e
 * grava os válidos via `upsertFromImport` (a planilha sobrescreve o contexto).
 *
 * Nunca chama envio de template nem o repositório de conversa.
 */
export class ImportLeadsUseCase {
  private readonly leads: LeadRepositoryPort;
  private readonly maxRows: number;

  constructor(deps: ImportLeadsUseCaseDeps) {
    this.leads = deps.leads;
    this.maxRows = deps.maxRows ?? MAX_IMPORT_ROWS;
  }

  async import(input: ImportLeadsInput): Promise<ImportLeadsResult> {
    if (input.leads.length > this.maxRows) {
      throw new LeadBatchTooLargeError(input.leads.length, this.maxRows);
    }

    const rejected: ImportRejectedRow[] = [];
    /** telefone E.164 → item válido (última ocorrência vence). */
    const valid = new Map<string, LeadImportInput>();

    input.leads.forEach((item, row) => {
      const normalized = normalizeBrazilPhone(item.phone);
      if ("rejected" in normalized) {
        rejected.push({ row, phone: item.phone ?? "", reason: normalized.rejected });
        return;
      }
      valid.set(normalized.phone, {
        phone: normalized.phone,
        displayName: item.displayName,
        source: item.source,
        notes: item.notes,
        company: item.company,
        segment: item.segment,
        city: item.city,
      });
    });

    let imported = 0;
    let updated = 0;
    for (const entry of valid.values()) {
      const outcome = await this.leads.upsertFromImport(entry);
      if (outcome.existed) {
        updated += 1;
      } else {
        imported += 1;
      }
    }

    return { imported, updated, rejected };
  }
}
