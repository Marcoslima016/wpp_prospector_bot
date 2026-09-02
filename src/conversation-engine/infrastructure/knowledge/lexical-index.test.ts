import { describe, expect, it } from "vitest";
import type { KnowledgeChunk } from "./knowledge.types.ts";
import { LexicalIndex } from "./lexical-index.ts";
import { expandWithSynonyms, normalize, tokenize } from "./tokenizer.pt-br.ts";

function chunk(
  partial: Partial<KnowledgeChunk> & Pick<KnowledgeChunk, "id" | "body">,
): KnowledgeChunk {
  return {
    id: partial.id,
    module: partial.module ?? "geral",
    tier: partial.tier ?? "geral",
    kind: partial.kind ?? "funcionalidades",
    pinned: partial.pinned ?? false,
    title: partial.title ?? null,
    body: partial.body,
    text: partial.text ?? partial.body,
  };
}

describe("tokenizer PT-BR", () => {
  it("normaliza minúsculas e remove acentos", () => {
    expect(normalize("Conciliação FINANCEIRA à vista")).toBe("conciliacao financeira a vista");
  });

  it("remove stopwords e stemiza plurais", () => {
    expect(tokenize("as equipes e os pavimentos da obra")).toEqual(["equipe", "pavimento", "obra"]);
  });

  it("aproxima gerúndio e infinitivo pelo mesmo radical", () => {
    expect(tokenize("conferindo")).toEqual(tokenize("conferir"));
  });

  it("expande jargão de campo por expressão e por token", () => {
    const syn = { "bater ponto": ["equipes-presenca"], extrato: ["artisys-finance"] };
    expect(expandWithSynonyms("preciso bater ponto da equipe", syn)).toContain("equipes-presenca");
    expect(expandWithSynonyms("perco tempo com o extrato", syn)).toContain("artisys-finance");
    expect(expandWithSynonyms("nada relacionado", syn)).toEqual([]);
  });
});

describe("LexicalIndex", () => {
  const chunks: KnowledgeChunk[] = [
    chunk({
      id: "presenca",
      module: "equipes-presenca",
      tier: "base",
      kind: "problema-solucao",
      body: "Registro diário de presença e de faltas dos colaboradores em campo.",
    }),
    chunk({
      id: "dre",
      module: "dre-custos",
      tier: "base",
      kind: "problema-solucao",
      body: "Visão de receitas, despesas e custo por obra, com centros de custo.",
    }),
    chunk({
      id: "extrato",
      module: "artisys-finance",
      tier: "extra",
      kind: "problema-solucao",
      body: "Conciliação bancária: compara o extrato com as obrigações e acha divergências.",
    }),
    chunk({
      id: "pinned-guard",
      kind: "guardrail",
      pinned: true,
      body: "Não mencionar BIM nem prometer economia específica.",
    }),
  ];

  const synonyms = {
    falta: ["equipes-presenca", "presenca"],
    "conferindo extrato": ["artisys-finance"],
    "quanto custa a obra": ["dre-custos"],
  };

  it("indexa apenas a fatia variável (ignora trechos pinned)", () => {
    const index = LexicalIndex.build(chunks, synonyms);
    expect(index.variableChunks.map((c) => c.id).sort()).toEqual(["dre", "extrato", "presenca"]);
  });

  it("rankeia o trecho mais relevante no topo", () => {
    const index = LexicalIndex.build(chunks, synonyms);
    const results = index.search("tenho problema para controlar faltas", { topK: 3, minScore: 0 });
    expect(results[0]!.chunk.id).toBe("presenca");
  });

  it("usa a expansão de sinônimos para fraseado conversacional", () => {
    const index = LexicalIndex.build(chunks, synonyms);
    const results = index.search("perco muito tempo conferindo extrato", { topK: 3, minScore: 0 });
    expect(results.map((r) => r.chunk.id)).toContain("extrato");
  });

  it("respeita topK e minScore", () => {
    const index = LexicalIndex.build(chunks, synonyms);
    expect(index.search("custo por obra", { topK: 1, minScore: 0 })).toHaveLength(1);
    expect(index.search("custo por obra", { topK: 5, minScore: 999 })).toHaveLength(0);
  });

  it("retorna vazio para query só com stopwords", () => {
    const index = LexicalIndex.build(chunks, synonyms);
    expect(index.search("oi tudo bem", { topK: 5, minScore: 0 })).toEqual([]);
  });
});
