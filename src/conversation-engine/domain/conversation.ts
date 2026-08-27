import type { BotDecision } from "./bot-decision.ts";
import { ConversationTurn } from "./conversation-turn.ts";
import type { LeadIntent } from "./lead-intent.ts";
import type { LeadQualification } from "./lead-qualification.ts";

export type ConversationLifecycle = "active" | "ended" | "awaitingHuman";

interface SerializedConversation {
  leadPhone: string;
  turns: ReturnType<ConversationTurn["toJSON"]>[];
  leadIntent: LeadIntent;
  leadQualification: LeadQualification | null;
  state: ConversationLifecycle;
  processedMessageIds: string[];
}

export interface RecordInboundTurnInput {
  text: string;
  timestamp: Date;
  messageId: string;
}

/**
 * Agregado que representa a conversa com um lead, identificado pelo telefone E.164.
 * Guarda o histórico de turnos, o status corrente do lead, o estado do ciclo de
 * vida e o conjunto de `messageId` já processados (deduplicação).
 */
export class Conversation {
  readonly leadPhone: string;
  private readonly _turns: ConversationTurn[];
  private _leadIntent: LeadIntent;
  private _leadQualification: LeadQualification | null;
  private _state: ConversationLifecycle;
  private readonly _processedMessageIds: Set<string>;

  private constructor(props: {
    leadPhone: string;
    turns: ConversationTurn[];
    leadIntent: LeadIntent;
    leadQualification: LeadQualification | null;
    state: ConversationLifecycle;
    processedMessageIds: Set<string>;
  }) {
    this.leadPhone = props.leadPhone;
    this._turns = props.turns;
    this._leadIntent = props.leadIntent;
    this._leadQualification = props.leadQualification;
    this._state = props.state;
    this._processedMessageIds = props.processedMessageIds;
  }

  static createNew(leadPhone: string): Conversation {
    return new Conversation({
      leadPhone,
      turns: [],
      leadIntent: "unknown",
      leadQualification: null,
      state: "active",
      processedMessageIds: new Set(),
    });
  }

  get turns(): readonly ConversationTurn[] {
    return this._turns;
  }

  get leadIntent(): LeadIntent {
    return this._leadIntent;
  }

  get leadQualification(): LeadQualification | null {
    return this._leadQualification;
  }

  get state(): ConversationLifecycle {
    return this._state;
  }

  /** O motor só deve gerar resposta automática enquanto a conversa não estiver aguardando humano. */
  get acceptsAutomatedReplies(): boolean {
    return this._state !== "awaitingHuman";
  }

  get pendingInboundTurns(): readonly ConversationTurn[] {
    return this._turns.filter((turn) => turn.direction === "inbound" && turn.pendingDecision);
  }

  hasProcessed(messageId: string): boolean {
    return this._processedMessageIds.has(messageId);
  }

  recordInboundTurn(input: RecordInboundTurnInput): void {
    if (this._processedMessageIds.has(input.messageId)) {
      return;
    }

    this._processedMessageIds.add(input.messageId);
    this._turns.push(
      ConversationTurn.inbound({
        text: input.text,
        timestamp: input.timestamp,
        messageId: input.messageId,
      }),
    );
  }

  markPending(messageIds: string[]): void {
    // Sem efeito prático hoje (turnos inbound nascem pendentes); mantido para
    // simetria com `clearPending` e para reprocessamento explícito no futuro.
    void messageIds;
  }

  clearPending(messageIds?: string[]): void {
    const target = messageIds ? new Set(messageIds) : undefined;
    for (const turn of this._turns) {
      if (turn.direction !== "inbound" || !turn.pendingDecision) continue;
      if (target && (turn.messageId === undefined || !target.has(turn.messageId))) continue;
      turn.clearPending();
    }
  }

  markPendingAbandoned(): void {
    for (const turn of this._turns) {
      if (turn.direction === "inbound" && turn.pendingDecision) {
        turn.markAbandoned();
      }
    }
  }

  /**
   * Reabre a conversa se ela estiver encerrada. Uma conversa aguardando
   * atendimento humano NÃO é reaberta automaticamente.
   */
  reopenIfEnded(): void {
    if (this._state === "ended") {
      this._state = "active";
    }
  }

  applyDecision(decision: BotDecision, now: Date = new Date()): void {
    for (const message of decision.replyMessages) {
      this._turns.push(
        ConversationTurn.outbound({
          text: message,
          timestamp: now,
          leadIntent: decision.leadIntent,
          leadQualification: decision.leadQualification,
          reasoning: decision.reasoning,
        }),
      );
    }

    this._leadIntent = decision.leadIntent;
    this._leadQualification = decision.leadQualification;

    // As mensagens inbound que motivaram esta decisão deixam de estar pendentes.
    this.clearPending();

    if (decision.handoffToHuman) {
      this._state = "awaitingHuman";
    } else if (decision.endConversation) {
      this._state = "ended";
    }
  }

  recentTurns(limit: number): readonly ConversationTurn[] {
    if (limit <= 0) return [];
    return this._turns.slice(-limit);
  }

  toJSON(): SerializedConversation {
    return {
      leadPhone: this.leadPhone,
      turns: this._turns.map((turn) => turn.toJSON()),
      leadIntent: this._leadIntent,
      leadQualification: this._leadQualification,
      state: this._state,
      processedMessageIds: [...this._processedMessageIds],
    };
  }

  static fromJSON(raw: SerializedConversation): Conversation {
    return new Conversation({
      leadPhone: raw.leadPhone,
      turns: raw.turns.map((turn) => ConversationTurn.fromJSON(turn)),
      leadIntent: raw.leadIntent,
      leadQualification: raw.leadQualification,
      state: raw.state,
      processedMessageIds: new Set(raw.processedMessageIds),
    });
  }
}
