import { E164_REGEX } from "../../whatsapp-connectivity/domain/outbound-message.ts";
import { InvalidLeadPhoneError } from "./errors.ts";
import type { LeadRecord, LeadRepositoryPort } from "./ports/lead-repository.port.ts";

export interface RegisterLeadInput {
  phone: string;
  displayName?: string;
  source?: string;
  notes?: string;
}

export interface RegisterLeadUseCaseDeps {
  leads: LeadRepositoryPort;
}

/**
 * Cadastra um lead para prospecção (ou atualiza o contexto de um já cadastrado).
 * Deduplicação e carimbos de tempo ficam no repositório; aqui só validamos o
 * telefone. Não altera o estado de prospecção de um lead existente.
 */
export class RegisterLeadUseCase {
  private readonly leads: LeadRepositoryPort;

  constructor(deps: RegisterLeadUseCaseDeps) {
    this.leads = deps.leads;
  }

  register(input: RegisterLeadInput): Promise<LeadRecord> {
    if (!E164_REGEX.test(input.phone)) {
      return Promise.reject(new InvalidLeadPhoneError(input.phone));
    }
    return this.leads.upsert(input);
  }
}
