import type { KnowledgeChunk } from "./knowledge.types.ts";

/**
 * Monta o conjunto `pinned` obrigatório: os trechos fixos da base
 * (posicionamento curto + guardrails + eventuais trechos `preco`) seguidos da
 * tabela de planos e preços (`pricing.md` inteiro). Esse bloco entra SEMPRE no
 * contexto do LLM, independentemente do resultado da busca.
 */
export function buildPinnedContext(chunks: KnowledgeChunk[], pricingMarkdown: string): string {
  const pinned = chunks.filter((c) => c.pinned);

  const parts = pinned.map((c) => c.text.trim());
  parts.push(pricingMarkdown.trim());

  return parts.join("\n\n").trim();
}
