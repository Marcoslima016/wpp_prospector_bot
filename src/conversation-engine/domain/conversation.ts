import type { BotDecision } from "./bot-decision.ts";
import { ConversationTurn } from "./conversation-turn.ts";
import type { LeadIntent } from "./lead-intent.ts";
import type { LeadQualification } from "./lead-qualification.ts";
import type { CommercialPlan, ModuleId } from "./product-catalog.ts";

export type ConversationLifecycle = "active" | "ended" | "awaitingHuman";

interface SerializedConversation {
  leadPhone: string;
  turns: ReturnType<ConversationTurn["toJSON"]>[];
  leadIntent: LeadIntent;
  leadQualification: LeadQualification | null;
  state: ConversationLifecycle;
  processedMessageIds: string[];
  recommendedModules?: ModuleId[];
  interestedModules?: ModuleId[];
  quotedPlan?: CommercialPlan | null;
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
  /** Acumulado da conversa: módulos já ofertados pelo bot. */
  private _recommendedModules: ModuleId[];
  /** Acumulado da conversa: módulos em que o lead demonstrou interesse. */
  private _interestedModules: ModuleId[];
  /** Último plano cujo preço foi citado ao lead (sticky). */
  private _quotedPlan: CommercialPlan | null;

  private constructor(props: {
    leadPhone: string;
    turns: ConversationTurn[];
    leadIntent: LeadIntent;
    leadQualification: LeadQualification | null;
    state: ConversationLifecycle;
    processedMessageIds: Set<string>;
    recommendedModules: ModuleId[];
    interestedModules: ModuleId[];
    quotedPlan: CommercialPlan | null;
  }) {
    this.leadPhone = props.leadPhone;
    this._turns = props.turns;
    this._leadIntent = props.leadIntent;
    this._leadQualification = props.leadQualification;
    this._state = props.state;
    this._processedMessageIds = props.processedMessageIds;
    this._recommendedModules = props.recommendedModules;
    this._interestedModules = props.interestedModules;
    this._quotedPlan = props.quotedPlan;
  }

  static createNew(leadPhone: string): Conversation {
    return new Conversation({
      leadPhone,
      turns: [],
      leadIntent: "unknown",
      leadQualification: null,
      state: "active",
      processedMessageIds: new Set(),
      recommendedModules: [],
      interestedModules: [],
      quotedPlan: null,
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

  /** Módulos que o bot já ofertou ao longo da conversa. */
  get recommendedModules(): readonly ModuleId[] {
    return this._recommendedModules;
  }

  /** Módulos em que o lead demonstrou interesse ao longo da conversa. */
  get interestedModules(): readonly ModuleId[] {
    return this._interestedModules;
  }

  /** Último plano cujo preço foi citado ao lead, ou `null`. */
  get quotedPlan(): CommercialPlan | null {
    return this._quotedPlan;
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
    const recommendedModules = [...decision.recommendedModules];
    const interestedModules = [...decision.interestedModules];

    for (const message of decision.replyMessages) {
      this._turns.push(
        ConversationTurn.outbound({
          text: message,
          timestamp: now,
          leadIntent: decision.leadIntent,
          leadQualification: decision.leadQualification,
          reasoning: decision.reasoning,
          recommendedModules,
          interestedModules,
          quotedPlan: decision.quotedPlan,
          origin: "bot",
        }),
      );
    }

    this._leadIntent = decision.leadIntent;
    this._leadQualification = decision.leadQualification;
    this._recommendedModules = unionModules(this._recommendedModules, recommendedModules);
    this._interestedModules = unionModules(this._interestedModules, interestedModules);
    if (decision.quotedPlan !== null) {
      this._quotedPlan = decision.quotedPlan;
    }

    // As mensagens inbound que motivaram esta decisão deixam de estar pendentes.
    this.clearPending();

    if (decision.handoffToHuman) {
      this._state = "awaitingHuman";
    } else if (decision.endConversation) {
      this._state = "ended";
    }
  }

  /**
   * Transição manual, iniciada por um operador: coloca a conversa em atendimento
   * humano a partir de `active` ou `ended`. Não exige uma `BotDecision` e não
   * toca na intenção nem na qualificação do lead. Idempotente se já em
   * `awaitingHuman`.
   */
  handoffToHuman(): void {
    this._state = "awaitingHuman";
  }

  /**
   * Transição manual, iniciada por um operador: devolve a conversa para `active`
   * a partir de `awaitingHuman` ou de `ended` (reabrindo-a), fazendo o bot voltar
   * a responder. Idempotente se já em `active`.
   */
  resumeFromHuman(): void {
    this._state = "active";
  }

  /**
   * Registra um turno outbound escrito à mão por um operador (mensagem avulsa
   * pelo painel). Não altera o estado do ciclo de vida nem a intenção/qualificação.
   */
  recordManualOutboundTurn(text: string, now: Date = new Date()): void {
    this._turns.push(ConversationTurn.manualOutbound({ text, timestamp: now }));
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
      recommendedModules: [...this._recommendedModules],
      interestedModules: [...this._interestedModules],
      quotedPlan: this._quotedPlan,
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
      // Retrocompat: conversas salvas antes desta mudança não têm os campos.
      recommendedModules: raw.recommendedModules ?? [],
      interestedModules: raw.interestedModules ?? [],
      quotedPlan: raw.quotedPlan ?? null,
    });
  }
}

function unionModules(current: ModuleId[], incoming: ModuleId[]): ModuleId[] {
  if (incoming.length === 0) return current;
  const merged = new Set<ModuleId>(current);
  for (const id of incoming) merged.add(id);
  return [...merged];
}
