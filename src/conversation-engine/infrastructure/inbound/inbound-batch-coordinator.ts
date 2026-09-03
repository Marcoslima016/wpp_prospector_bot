import type {
  InboundMessageDto,
  InboundMessagePort,
} from "../../../whatsapp-connectivity/application/ports/inbound-message.port.ts";
import type { ConversationRepositoryPort } from "../../application/ports/conversation-repository.port.ts";
import type { Logger } from "../../application/ports/logger.port.ts";
import { Conversation } from "../../domain/conversation.ts";
import { toE164LeadPhone } from "../../domain/lead-phone.ts";
import { LeadSerialQueue } from "./lead-serial-queue.ts";

export interface GenerateReplyPort {
  execute(leadPhone: string, messageIds: string[]): Promise<void>;
}

export interface InboundBatchCoordinatorDeps {
  repository: ConversationRepositoryPort;
  generateReply: GenerateReplyPort;
  logger: Logger;
  /** Janela fixa de coalescing, a partir da primeira mensagem ainda não processada. */
  batchWindowMs: number;
  /**
   * Fila serial por lead. Compartilhada com as ações de operação do painel para
   * que uma ação não colida com uma geração de resposta em andamento. Opcional:
   * quando ausente, o coordenador usa uma fila própria.
   */
  queue?: LeadSerialQueue;
}

/**
 * Implementa `InboundMessagePort`. Por lead: persiste o inbound como pendente,
 * agrupa os identificadores numa janela fixa e, ao fechar a janela, dispara o
 * `GenerateReplyUseCase`. As operações por lead são serializadas numa fila.
 */
export class InboundBatchCoordinator implements InboundMessagePort {
  private readonly repository: ConversationRepositoryPort;
  private readonly generateReply: GenerateReplyPort;
  private readonly logger: Logger;
  private readonly batchWindowMs: number;
  private readonly queue: LeadSerialQueue;

  private readonly buffers = new Map<string, string[]>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(deps: InboundBatchCoordinatorDeps) {
    this.repository = deps.repository;
    this.generateReply = deps.generateReply;
    this.logger = deps.logger;
    this.batchWindowMs = deps.batchWindowMs;
    this.queue = deps.queue ?? new LeadSerialQueue();
  }

  receive(message: InboundMessageDto): void {
    const leadPhone = toE164LeadPhone(message.from);

    this.enqueue(leadPhone, async () => {
      const conversation =
        (await this.repository.load(leadPhone)) ?? Conversation.createNew(leadPhone);

      if (conversation.hasProcessed(message.messageId)) {
        this.logger.info("Mensagem inbound duplicada ignorada", {
          leadPhone,
          messageId: message.messageId,
        });
        return;
      }

      conversation.recordInboundTurn({
        text: message.text,
        timestamp: message.timestamp,
        messageId: message.messageId,
      });
      await this.repository.save(conversation);

      if (!conversation.acceptsAutomatedReplies) {
        this.logger.info(
          "Conversa aguardando atendimento humano — inbound registrado sem agendar resposta",
          { leadPhone, messageId: message.messageId },
        );
        return;
      }

      this.bufferAndSchedule(leadPhone, message.messageId);
    });
  }

  /** Reenfileira um lote pendente para processamento imediato (usado na varredura de boot). */
  enqueuePendingBatch(leadPhone: string, messageIds: string[]): void {
    if (messageIds.length === 0) return;
    const normalized = toE164LeadPhone(leadPhone);
    this.enqueue(normalized, () => this.generateReply.execute(normalized, messageIds));
  }

  /** Aguarda o esvaziamento da fila serial de todos os leads (auxiliar de teste/shutdown). */
  async whenSettled(): Promise<void> {
    await this.queue.whenSettled();
  }

  private bufferAndSchedule(leadPhone: string, messageId: string): void {
    const buffer = this.buffers.get(leadPhone) ?? [];
    buffer.push(messageId);
    this.buffers.set(leadPhone, buffer);

    // A janela conta a partir da primeira mensagem pendente: se já há um timer
    // aberto para este lead, a mensagem apenas entra no lote corrente.
    if (this.timers.has(leadPhone)) return;

    const timer = setTimeout(() => {
      this.timers.delete(leadPhone);
      const ids = this.buffers.get(leadPhone) ?? [];
      this.buffers.delete(leadPhone);
      if (ids.length === 0) return;
      this.enqueue(leadPhone, () => this.generateReply.execute(leadPhone, ids));
    }, this.batchWindowMs);

    timer.unref?.();
    this.timers.set(leadPhone, timer);
  }

  private enqueue(leadPhone: string, task: () => Promise<void>): void {
    void this.queue.run(leadPhone, task).catch((error: unknown) => {
      this.logger.error("Falha ao processar inbound do lead na fila serial", {
        leadPhone,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}
