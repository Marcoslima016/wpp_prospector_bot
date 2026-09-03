import type { ConversationRepositoryPort } from "../../conversation-engine/application/ports/conversation-repository.port.ts";
import { Conversation } from "../../conversation-engine/domain/conversation.ts";
import type { LeadSerialQueue } from "../../conversation-engine/infrastructure/inbound/lead-serial-queue.ts";
import { E164_REGEX, type OutboundMessageInput } from "../../whatsapp-connectivity/domain/outbound-message.ts";
import type { SendOutboundMessageUseCase } from "../../whatsapp-connectivity/application/use-cases/send-outbound-message.use-case.ts";
import {
  FirstContactTemplateNotConfiguredError,
  InvalidLeadPhoneError,
  LeadNotFoundError,
  ProspectingGatewayError,
} from "./errors.ts";
import type { FirstContactTemplateConfig } from "./first-contact-template.ts";
import type { AdminActionAuditPort } from "./ports/admin-action-audit.port.ts";
import type { LeadRecord, LeadRepositoryPort } from "./ports/lead-repository.port.ts";
import type { Logger } from "./ports/logger.port.ts";

/** Parâmetros do template: array já posicional, ou objeto nomeado mapeado por `paramKeys`. */
export type ProspectTemplateParameters = string[] | Record<string, string>;

export interface ProspectLeadOptions {
  parameters?: ProspectTemplateParameters;
  /** Reenvia mesmo que o lead já tenha sido prospectado com sucesso. */
  force?: boolean;
}

export interface ProspectLeadOutcome {
  /** `wamid` do template enviado; `null` quando o disparo foi ignorado por idempotência. */
  wamid: string | null;
  /** `true` quando o lead já havia sido prospectado e o disparo foi ignorado (sem `force`). */
  alreadyProspected: boolean;
  lead: LeadRecord;
}

export interface ProspectLeadUseCaseDeps {
  leads: LeadRepositoryPort;
  conversations: ConversationRepositoryPort;
  queue: LeadSerialQueue;
  sendTemplate: SendOutboundMessageUseCase;
  template: FirstContactTemplateConfig;
  audit: AdminActionAuditPort;
  logger: Logger;
  clock?: () => Date;
}

/**
 * Dispara o primeiro contato de prospecção de um lead: envia um template
 * aprovado e semeia (ou atualiza) a conversa com o turno inicial de origem
 * `operator`/`kind: "prospecting"`. Idempotente por lead (salvo `force`);
 * o envio + a semeadura rodam na fila serial do lead, para não colidir com uma
 * geração de resposta em andamento. Auditoria best-effort.
 */
export class ProspectLeadUseCase {
  private readonly leads: LeadRepositoryPort;
  private readonly conversations: ConversationRepositoryPort;
  private readonly queue: LeadSerialQueue;
  private readonly sendTemplate: SendOutboundMessageUseCase;
  private readonly template: FirstContactTemplateConfig;
  private readonly audit: AdminActionAuditPort;
  private readonly logger: Logger;
  private readonly clock: () => Date;

  constructor(deps: ProspectLeadUseCaseDeps) {
    this.leads = deps.leads;
    this.conversations = deps.conversations;
    this.queue = deps.queue;
    this.sendTemplate = deps.sendTemplate;
    this.template = deps.template;
    this.audit = deps.audit;
    this.logger = deps.logger;
    this.clock = deps.clock ?? (() => new Date());
  }

  async prospect(leadPhone: string, options: ProspectLeadOptions = {}): Promise<ProspectLeadOutcome> {
    if (!E164_REGEX.test(leadPhone)) {
      throw new InvalidLeadPhoneError(leadPhone);
    }

    const lead = await this.leads.findByPhone(leadPhone);
    if (lead === null) {
      throw new LeadNotFoundError(leadPhone);
    }

    const alreadyContacted =
      lead.prospectingState === "sent" || lead.prospectingState === "replied";
    if (alreadyContacted && options.force !== true) {
      return { wamid: null, alreadyProspected: true, lead };
    }

    return this.queue.run(leadPhone, async () => {
      const now = this.clock();
      const input = this.resolveTemplateInput(leadPhone, options.parameters);

      let wamid: string;
      try {
        const sent = await this.sendTemplate.execute(input);
        wamid = sent.wamid;
      } catch (error) {
        await this.leads.markFailed(leadPhone, now);
        throw new ProspectingGatewayError(leadPhone, describeError(error), { cause: error });
      }

      const conversation =
        (await this.conversations.load(leadPhone)) ?? Conversation.createNew(leadPhone);
      conversation.recordProspectingOutboundTurn(renderTemplateTurnText(input), now);
      await this.conversations.save(conversation);

      await this.leads.markProspected(leadPhone, wamid, now);
      await this.recordAudit(leadPhone, now);

      const updated = await this.leads.findByPhone(leadPhone);
      return { wamid, alreadyProspected: false, lead: updated ?? lead };
    });
  }

  private resolveTemplateInput(
    leadPhone: string,
    parameters: ProspectTemplateParameters | undefined,
  ): OutboundMessageInput {
    if (this.template.name.trim().length === 0) {
      throw new FirstContactTemplateNotConfiguredError();
    }

    return {
      to: leadPhone,
      templateName: this.template.name,
      languageCode: this.template.lang,
      parameters: this.positionalParameters(parameters),
    };
  }

  private positionalParameters(parameters: ProspectTemplateParameters | undefined): string[] {
    if (parameters === undefined) return [];
    if (Array.isArray(parameters)) return parameters;
    if (this.template.paramKeys.length > 0) {
      return this.template.paramKeys.map((key) => parameters[key] ?? "");
    }
    return Object.values(parameters);
  }

  private async recordAudit(leadPhone: string, now: Date): Promise<void> {
    try {
      await this.audit.record({
        actor: "operator",
        action: "prospect",
        leadPhone,
        occurredAt: now,
      });
    } catch (error) {
      this.logger.warn("Falha ao registrar o disparo de prospecção na auditoria — ação mantida", {
        leadPhone,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Representação legível do turno de primeiro contato no histórico da conversa. */
function renderTemplateTurnText(input: OutboundMessageInput): string {
  const params = input.parameters ?? [];
  const suffix = params.length > 0 ? ` (${params.join(" | ")})` : "";
  return `[primeiro contato · template: ${input.templateName}${suffix}]`;
}
