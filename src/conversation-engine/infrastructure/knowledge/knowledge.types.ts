import type { ModuleId, ModuleTier } from "../../domain/product-catalog.ts";

/** Tipos de conteúdo de um trecho da base de conhecimento comercial. */
export const KNOWLEDGE_KINDS = [
  "visao",
  "funcionalidades",
  "problema-solucao",
  "publico",
  "guardrail",
  "objecao",
  "discovery",
  "preco",
] as const;

export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

/** Um trecho delimitado de `sales-knowledge.md`, já com metadados validados. */
export interface KnowledgeChunk {
  /** Identificador estável do trecho (único no arquivo). */
  id: string;
  /** Módulo do catálogo a que o trecho pertence, ou `geral`. */
  module: ModuleId | "geral";
  /** Camada comercial: `base`, `extra` ou `geral`. */
  tier: ModuleTier;
  /** Tipo de conteúdo. */
  kind: KnowledgeKind;
  /**
   * `true` → o trecho entra SEMPRE no contexto (não depende de busca).
   * Trechos `kind` guardrail/preco são sempre pinned.
   */
  pinned: boolean;
  /** Título legível do trecho, quando informado. */
  title: string | null;
  /** Corpo do trecho (sem os metadados). */
  body: string;
  /** Bloco pronto para o prompt: título + corpo. */
  text: string;
}
