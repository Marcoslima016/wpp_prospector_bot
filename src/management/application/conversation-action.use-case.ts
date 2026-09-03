import type { ConversationRepositoryPort } from "../../conversation-engine/application/ports/conversation-repository.port.ts";
import type { Conversation } from "../../conversation-engine/domain/conversation.ts";
import type { LeadSerialQueue } from "../../conversation-engine/infrastructure/inbound/lead-serial-queue.ts";
import { WhatsAppApiError } from "../../whatsapp-connectivity/application/errors.ts";
import type { SendTextMessageUseCase } from "../../whatsapp-connectivity/application/use-cases/send-text-message.use-case.ts";
import type { AdminActionAuditPort, AdminActionType } from "./ports/admin-action-audit.port.ts";
import type { Logger } from "./ports/logger.port.ts";
import {
  ConversationNotFoundError,
  EmptyMessageTextError,
  SessionWindowClosedError,
} from "./errors.ts";

/** Janela de atendimento de sessão do WhatsApp: 24 h a partir do último inbound do lead. */
const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Códigos de erro da Cloud API que indicam mensagem fora da janela de 24 h
 * (re-engagement). Mapeados para `SessionWindowClosedError`.
 */
const RE_ENGAGEMENT_ERROR_CODES = new Set(["131047", "470"]);

export interface ConversationActionUseCaseDeps {
  repository: ConversationRepositoryPort;
  queue: LeadSerialQueue;
  sendText: SendTextMessageUseCase;
  audit: AdminActionAuditPort;
  logger: Logger;
  clock?: () => Date;
}

/**
 * Orquestra as ações de operação sobre uma conversa (handoff, retomada, envio de
 * mensagem avulsa). Cada ação roda `load → mutar → save → auditar` dentro da fila
 * serial do lead, para não colidir com uma geração de resposta em andamento. A
 * auditoria é best-effort: uma falha ao registrar não desfaz a ação.
 */
export class ConversationActionUseCase {
  private readonly repository: ConversationRepositoryPort;
  private readonly queue: LeadSerialQueue;
  private readonly sendText: SendTextMessageUseCase;
  private readonly audit: AdminActionAuditPort;
  private readonly logger: Logger;
  private readonly clock: () => Date;

  constructor(deps: ConversationActionUseCaseDeps) {
    this.repository = deps.repository;
    this.queue = deps.queue;
    this.sendText = deps.sendText;
    this.audit = deps.audit;
    this.logger = deps.logger;
    this.clock = deps.clock ?? (() => new Date());
  }

  handoff(leadPhone: string): Promise<Conversation> {
    return this.queue.run(leadPhone, async () => {
      const conversation = await this.loadOrThrow(leadPhone);
      conversation.handoffToHuman();
      await this.repository.save(conversation);
      await this.recordAudit("handoff", leadPhone);
      return conversation;
    });
  }

  resume(leadPhone: string): Promise<Conversation> {
    return this.queue.run(leadPhone, async () => {
      const conversation = await this.loadOrThrow(leadPhone);
      conversation.resumeFromHuman();
      await this.repository.save(conversation);
      await this.recordAudit("resume", leadPhone);
      return conversation;
    });
  }

  sendMessage(leadPhone: string, text: string): Promise<Conversation> {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return Promise.reject(new EmptyMessageTextError());
    }

    return this.queue.run(leadPhone, async () => {
      const conversation = await this.loadOrThrow(leadPhone);
      const now = this.clock();
      this.assertSessionWindowOpen(conversation, now);

      try {
        await this.sendText.execute({ to: leadPhone, body: text });
      } catch (error) {
        if (error instanceof WhatsAppApiError && RE_ENGAGEMENT_ERROR_CODES.has(error.code ?? "")) {
          throw new SessionWindowClosedError(
            "A Cloud API recusou o envio: janela de atendimento de 24 h fechada",
          );
        }
        throw error;
      }

      conversation.recordManualOutboundTurn(text, now);
      await this.repository.save(conversation);
      await this.recordAudit("send-message", leadPhone);
      return conversation;
    });
  }

  private async loadOrThrow(leadPhone: string): Promise<Conversation> {
    const conversation = await this.repository.load(leadPhone);
    if (conversation === null) {
      throw new ConversationNotFoundError(leadPhone);
    }
    return conversation;
  }

  private assertSessionWindowOpen(conversation: Conversation, now: Date): void {
    const lastInbound = [...conversation.turns]
      .reverse()
      .find((turn) => turn.direction === "inbound");

    const openedAt = lastInbound?.timestamp.getTime();
    if (openedAt === undefined || now.getTime() - openedAt > SESSION_WINDOW_MS) {
      throw new SessionWindowClosedError(
        "A janela de atendimento de 24 h está fechada — o lead precisa mandar uma mensagem primeiro",
      );
    }
  }

  private async recordAudit(action: AdminActionType, leadPhone: string): Promise<void> {
    try {
      await this.audit.record({
        actor: "operator",
        action,
        leadPhone,
        occurredAt: this.clock(),
      });
    } catch (error) {
      this.logger.warn("Falha ao registrar ação de operação na auditoria — ação mantida", {
        action,
        leadPhone,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
