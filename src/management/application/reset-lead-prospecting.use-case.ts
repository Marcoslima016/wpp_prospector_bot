import { E164_REGEX } from "../../whatsapp-connectivity/domain/outbound-message.ts";
import { InvalidLeadPhoneError, LeadNotFoundError } from "./errors.ts";
import type { AdminActionAuditPort } from "./ports/admin-action-audit.port.ts";
import type { LeadRecord, LeadRepositoryPort } from "./ports/lead-repository.port.ts";
import type { Logger } from "./ports/logger.port.ts";

export interface ResetLeadProspectingUseCaseDeps {
  leads: LeadRepositoryPort;
  audit: AdminActionAuditPort;
  logger: Logger;
  clock?: () => Date;
}

/**
 * Devolve um lead já contatado ao estado `pending`, limpando os carimbos de
 * primeiro contato, para reabrir a prospecção. Age somente sobre o registro do
 * lead — não toca o agregado `Conversation` nem os turnos: um disparo posterior
 * cai no ramo "conversa já existe ⇒ acrescenta turno" do `ProspectLeadUseCase`.
 * Idempotente sobre `pending`. Auditoria best-effort (`reset_prospecting`).
 * Fora da `LeadSerialQueue` (escrita só na tabela `leads`).
 */
export class ResetLeadProspectingUseCase {
  private readonly leads: LeadRepositoryPort;
  private readonly audit: AdminActionAuditPort;
  private readonly logger: Logger;
  private readonly clock: () => Date;

  constructor(deps: ResetLeadProspectingUseCaseDeps) {
    this.leads = deps.leads;
    this.audit = deps.audit;
    this.logger = deps.logger;
    this.clock = deps.clock ?? (() => new Date());
  }

  async reset(leadPhone: string): Promise<LeadRecord> {
    if (!E164_REGEX.test(leadPhone)) {
      throw new InvalidLeadPhoneError(leadPhone);
    }

    const existing = await this.leads.findByPhone(leadPhone);
    if (existing === null) {
      throw new LeadNotFoundError(leadPhone);
    }

    await this.leads.resetProspecting(leadPhone);
    await this.recordAudit(leadPhone);

    const updated = await this.leads.findByPhone(leadPhone);
    return updated ?? existing;
  }

  private async recordAudit(leadPhone: string): Promise<void> {
    try {
      await this.audit.record({
        actor: "operator",
        action: "reset_prospecting",
        leadPhone,
        occurredAt: this.clock(),
      });
    } catch (error) {
      this.logger.warn("Falha ao registrar o reset de prospecção na auditoria — ação mantida", {
        leadPhone,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
