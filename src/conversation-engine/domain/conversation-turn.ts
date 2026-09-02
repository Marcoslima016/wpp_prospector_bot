import type { LeadIntent } from "./lead-intent.ts";
import type { LeadQualification } from "./lead-qualification.ts";
import type { CommercialPlan, ModuleId } from "./product-catalog.ts";

export type TurnDirection = "inbound" | "outbound";

export interface InboundTurnProps {
  text: string;
  timestamp: Date;
  messageId: string;
}

export interface OutboundTurnProps {
  text: string;
  timestamp: Date;
  leadIntent: LeadIntent;
  leadQualification: LeadQualification | null;
  reasoning: string | null;
  recommendedModules: ModuleId[];
  interestedModules: ModuleId[];
  quotedPlan: CommercialPlan | null;
}

interface SerializedTurn {
  direction: TurnDirection;
  text: string;
  timestamp: string;
  messageId?: string;
  pendingDecision?: boolean;
  abandoned?: boolean;
  leadIntent?: LeadIntent;
  leadQualification?: LeadQualification | null;
  reasoning?: string | null;
  recommendedModules?: ModuleId[];
  interestedModules?: ModuleId[];
  quotedPlan?: CommercialPlan | null;
}

/**
 * Um turno da conversa. Turnos `inbound` carregam o `messageId` da Meta e um
 * estado de decisão pendente (a mensagem foi persistida mas ainda não produziu
 * uma resposta). Turnos `outbound` carregam os metadados da decisão que os gerou.
 */
export class ConversationTurn {
  readonly direction: TurnDirection;
  readonly text: string;
  readonly timestamp: Date;
  readonly messageId?: string;
  private _pendingDecision: boolean;
  private _abandoned: boolean;
  readonly leadIntent?: LeadIntent;
  readonly leadQualification?: LeadQualification | null;
  readonly reasoning?: string | null;
  readonly recommendedModules: readonly ModuleId[];
  readonly interestedModules: readonly ModuleId[];
  readonly quotedPlan: CommercialPlan | null;

  private constructor(props: {
    direction: TurnDirection;
    text: string;
    timestamp: Date;
    messageId?: string;
    pendingDecision?: boolean;
    abandoned?: boolean;
    leadIntent?: LeadIntent;
    leadQualification?: LeadQualification | null;
    reasoning?: string | null;
    recommendedModules?: ModuleId[];
    interestedModules?: ModuleId[];
    quotedPlan?: CommercialPlan | null;
  }) {
    this.direction = props.direction;
    this.text = props.text;
    this.timestamp = props.timestamp;
    this.messageId = props.messageId;
    this._pendingDecision = props.pendingDecision ?? false;
    this._abandoned = props.abandoned ?? false;
    this.leadIntent = props.leadIntent;
    this.leadQualification = props.leadQualification;
    this.reasoning = props.reasoning;
    this.recommendedModules = props.recommendedModules ?? [];
    this.interestedModules = props.interestedModules ?? [];
    this.quotedPlan = props.quotedPlan ?? null;
  }

  static inbound(props: InboundTurnProps): ConversationTurn {
    return new ConversationTurn({
      direction: "inbound",
      text: props.text,
      timestamp: props.timestamp,
      messageId: props.messageId,
      pendingDecision: true,
    });
  }

  static outbound(props: OutboundTurnProps): ConversationTurn {
    return new ConversationTurn({
      direction: "outbound",
      text: props.text,
      timestamp: props.timestamp,
      leadIntent: props.leadIntent,
      leadQualification: props.leadQualification,
      reasoning: props.reasoning,
      recommendedModules: props.recommendedModules,
      interestedModules: props.interestedModules,
      quotedPlan: props.quotedPlan,
    });
  }

  get pendingDecision(): boolean {
    return this._pendingDecision;
  }

  get abandoned(): boolean {
    return this._abandoned;
  }

  clearPending(): void {
    this._pendingDecision = false;
  }

  markAbandoned(): void {
    this._pendingDecision = false;
    this._abandoned = true;
  }

  toJSON(): SerializedTurn {
    const serialized: SerializedTurn = {
      direction: this.direction,
      text: this.text,
      timestamp: this.timestamp.toISOString(),
    };

    if (this.direction === "inbound") {
      serialized.messageId = this.messageId;
      serialized.pendingDecision = this._pendingDecision;
      if (this._abandoned) serialized.abandoned = true;
    } else {
      serialized.leadIntent = this.leadIntent;
      serialized.leadQualification = this.leadQualification;
      serialized.reasoning = this.reasoning;
      serialized.recommendedModules = [...this.recommendedModules];
      serialized.interestedModules = [...this.interestedModules];
      serialized.quotedPlan = this.quotedPlan;
    }

    return serialized;
  }

  static fromJSON(raw: SerializedTurn): ConversationTurn {
    return new ConversationTurn({
      direction: raw.direction,
      text: raw.text,
      timestamp: new Date(raw.timestamp),
      messageId: raw.messageId,
      pendingDecision: raw.pendingDecision,
      abandoned: raw.abandoned,
      leadIntent: raw.leadIntent,
      leadQualification: raw.leadQualification,
      reasoning: raw.reasoning,
      // Retrocompat: turnos salvos antes desta mudança não têm os campos.
      recommendedModules: raw.recommendedModules ?? [],
      interestedModules: raw.interestedModules ?? [],
      quotedPlan: raw.quotedPlan ?? null,
    });
  }
}
