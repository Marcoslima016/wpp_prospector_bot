/**
 * Estado de prospecção de um lead. Evolui com o resultado do primeiro contato
 * (envio do template) e com o primeiro inbound subsequente do lead.
 */
export type ProspectingState = "pending" | "sent" | "replied" | "failed";

/** Um lead cadastrado para prospecção ativa, como lido do armazenamento. */
export interface LeadRecord {
  /** Telefone E.164 — chave do lead. */
  phone: string;
  displayName: string | null;
  source: string | null;
  notes: string | null;
  prospectingState: ProspectingState;
  /** `wamid` do template de primeiro contato, quando já enviado. */
  firstContactWamid: string | null;
  /** Instante em que o primeiro contato foi aceito pelo gateway (estado `sent`). */
  firstContactAt: Date | null;
  /** Instante do primeiro inbound do lead após o primeiro contato (estado `replied`). */
  repliedAt: Date | null;
}

/** Campos de contexto opcionais aceitos no cadastro/atualização de um lead. */
export interface LeadContextInput {
  phone: string;
  displayName?: string;
  source?: string;
  notes?: string;
}

/**
 * Repositório dos leads de prospecção. Deduplicado por telefone: um segundo
 * `upsert` do mesmo telefone atualiza apenas o contexto informado e preserva o
 * `prospectingState` corrente. As transições de estado (`markProspected`,
 * `markFailed`, `markReplied`) são operações explícitas.
 */
export interface LeadRepositoryPort {
  /** Cria o lead (`prospectingState: "pending"`) ou atualiza os campos de contexto informados. */
  upsert(input: LeadContextInput): Promise<LeadRecord>;
  /** Carrega o lead pelo telefone, ou `null` se não existir. */
  findByPhone(phone: string): Promise<LeadRecord | null>;
  /** Primeiro contato aceito pelo gateway → estado `sent`, guarda `wamid` e o instante. */
  markProspected(phone: string, wamid: string, at: Date): Promise<void>;
  /** Gateway rejeitou o primeiro contato → estado `failed`. */
  markFailed(phone: string, at: Date): Promise<void>;
  /** Primeiro inbound após o primeiro contato → estado `replied` (no-op fora de `sent`). */
  markReplied(phone: string, at: Date): Promise<void>;
}
