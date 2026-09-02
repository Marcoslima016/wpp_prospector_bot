import type { Conversation } from "../../domain/conversation.ts";

export interface BusinessContextInput {
  /** Conversa corrente (para histórico/estado, se a técnica de recuperação usar). */
  conversation: Conversation;
  /** Lote de mensagens novas do lead que motivaram esta interpretação. */
  newMessages: string[];
}

/**
 * Fonte do contexto de negócio para a interpretação. Abstrai a técnica de
 * recuperação (RAG léxico, prompt estático, etc.) atrás de uma única string —
 * o `domain` e o use case não conhecem RAG nem sabem quantas chamadas ao LLM
 * acontecem por baixo.
 *
 * A string retornada contém, no mínimo, o conjunto fixo obrigatório
 * (posicionamento, guardrails, planos/preços). Quando há trechos recuperados
 * para o turno, eles vêm depois do separador `RETRIEVED_CONTEXT_SEPARATOR`
 * (ver `domain/reply-strategy.ts`), para que o motor mantenha o prefixo estável
 * cacheável.
 */
export interface BusinessContextProvider {
  getContext(input: BusinessContextInput): Promise<string>;
}
