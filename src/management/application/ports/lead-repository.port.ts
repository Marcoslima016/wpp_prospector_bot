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
  /** Empresa/razão social do lead (contexto de importação). */
  company: string | null;
  /** Segmento de atuação do lead (contexto de importação). */
  segment: string | null;
  /** Cidade do lead (contexto de importação). */
  city: string | null;
  prospectingState: ProspectingState;
  /** `wamid` do template de primeiro contato, quando já enviado. */
  firstContactWamid: string | null;
  /** Instante em que o primeiro contato foi aceito pelo gateway (estado `sent`). */
  firstContactAt: Date | null;
  /** Instante do primeiro inbound do lead após o primeiro contato (estado `replied`). */
  repliedAt: Date | null;
  /** Instante da última importação em lote deste lead; `null` para cadastro manual. */
  importedAt: Date | null;
}

/** Campos de contexto opcionais aceitos no cadastro/atualização de um lead. */
export interface LeadContextInput {
  phone: string;
  displayName?: string;
  source?: string;
  notes?: string;
  company?: string;
  segment?: string;
  city?: string;
}

/**
 * Item de um lote de importação. Diferente de `LeadContextInput`, o caminho de
 * importação **sobrescreve** os campos de contexto informados (a planilha é a
 * fonte da verdade). Um campo ausente (`undefined`) não é tocado no registro
 * existente; um campo explicitamente `null` limpa o valor.
 */
export interface LeadImportInput {
  phone: string;
  displayName?: string | null;
  source?: string | null;
  notes?: string | null;
  company?: string | null;
  segment?: string | null;
  city?: string | null;
}

/** Resultado de `upsertFromImport`: o registro e se ele já existia antes. */
export interface LeadImportOutcome {
  lead: LeadRecord;
  /** `true` quando o telefone já era um lead (linha atualizada), `false` quando criado. */
  existed: boolean;
}

/** Filtros e paginação de `query`. */
export interface LeadQueryParams {
  state?: ProspectingState | undefined;
  /** Trecho do telefone (match parcial). */
  phoneContains?: string | undefined;
  segment?: string | undefined;
  limit: number;
  /** Cursor opaco devolvido em `nextCursor` da página anterior. */
  cursor?: string | undefined;
}

/** Página de `query`: itens + cursor da próxima página (`null` quando acabou). */
export interface LeadQueryPage {
  items: LeadRecord[];
  nextCursor: string | null;
}

/**
 * Repositório dos leads de prospecção. Deduplicado por telefone: um segundo
 * `upsert` do mesmo telefone atualiza apenas o contexto informado e preserva o
 * `prospectingState` corrente. As transições de estado (`markProspected`,
 * `markFailed`, `markReplied`) são operações explícitas.
 */
export interface LeadRepositoryPort {
  /** Cria o lead (`prospectingState: "pending"`) ou atualiza os campos de contexto informados (só preenche vazio). */
  upsert(input: LeadContextInput): Promise<LeadRecord>;
  /**
   * Caminho de importação em lote: cria o lead (`pending`) ou **sobrescreve** os
   * campos de contexto presentes no item, sempre carimbando `importedAt`. Nunca
   * toca `prospectingState` nem os carimbos de primeiro contato.
   */
  upsertFromImport(input: LeadImportInput): Promise<LeadImportOutcome>;
  /** Carrega o lead pelo telefone, ou `null` se não existir. */
  findByPhone(phone: string): Promise<LeadRecord | null>;
  /** Página filtrável e ordenada de forma estável (mais recente primeiro, telefone como desempate). */
  query(params: LeadQueryParams): Promise<LeadQueryPage>;
  /** Primeiro contato aceito pelo gateway → estado `sent`, guarda `wamid` e o instante. */
  markProspected(phone: string, wamid: string, at: Date): Promise<void>;
  /** Gateway rejeitou o primeiro contato → estado `failed`. */
  markFailed(phone: string, at: Date): Promise<void>;
  /** Primeiro inbound após o primeiro contato → estado `replied` (no-op fora de `sent`). */
  markReplied(phone: string, at: Date): Promise<void>;
  /**
   * Devolve o lead ao estado `pending` e limpa os carimbos de primeiro contato
   * (`firstContactWamid`, `firstContactAt`, `repliedAt`). Idempotente. Retorna
   * `true` quando havia uma linha para o telefone, `false` quando nenhuma foi
   * afetada (telefone sem lead).
   */
  resetProspecting(phone: string): Promise<boolean>;
}
