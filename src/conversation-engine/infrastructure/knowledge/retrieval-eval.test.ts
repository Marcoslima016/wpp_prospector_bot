import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LexicalIndex } from "./lexical-index.ts";
import { parseSalesKnowledge } from "./sales-knowledge.parser.ts";
import { localExtraction, signalsToQuery } from "./signal-extraction.ts";
import { FIELD_SYNONYMS } from "./synonyms.pt-br.ts";

/**
 * Avaliação determinística de recuperação (sem LLM): usa a extração LOCAL +
 * busca BM25 sobre a base real e afere `recall@k` do conjunto golden — as falas
 * de cliente → módulos esperados presentes nos payloads
 * (`base_conhecimento §54`, `modulos_funcionalidades §30`). Serve para calibrar
 * `synonyms.pt-br.ts`, `RETRIEVAL_TOP_K` e `RETRIEVAL_MIN_SCORE`.
 */

const KNOWLEDGE_DIR = dirname(fileURLToPath(import.meta.url));
const salesKnowledge = readFileSync(join(KNOWLEDGE_DIR, "sales-knowledge.md"), "utf8");
const index = LexicalIndex.build(parseSalesKnowledge(salesKnowledge), FIELD_SYNONYMS);

const TOP_K = 6;

interface GoldenPair {
  fala: string;
  modulos: string[];
}

const GOLDEN: GoldenPair[] = [
  {
    fala: "Tenho dificuldade para saber o que cada equipe está fazendo.",
    modulos: ["gestao-obras", "obra360"],
  },
  { fala: "O encarregado me manda tudo pelo WhatsApp.", modulos: ["gestao-obras"] },
  {
    fala: "Não consigo acompanhar em qual pavimento cada equipe está.",
    modulos: ["obra360", "planejamento-frentes"],
  },
  {
    fala: "Perco muito tempo conferindo pagamento de funcionário.",
    modulos: ["artisys-finance", "vales-pagamentos"],
  },
  {
    fala: "Tenho várias planilhas de funcionários e documentos.",
    modulos: ["fluxodre-desktop", "colaboradores-documentos"],
  },
  { fala: "Minha equipe possui dificuldade com leitura ou matemática.", modulos: ["universidade"] },
  {
    fala: "Não sei o que minhas equipes estão fazendo.",
    modulos: ["gestao-obras", "obra360", "planejamento-frentes"],
  },
  {
    fala: "Meu encarregado manda tudo por WhatsApp.",
    modulos: ["gestao-obras", "equipes-presenca", "obra360"],
  },
  { fala: "Tenho problema para controlar faltas.", modulos: ["equipes-presenca"] },
  { fala: "Tenho várias equipes em vários andares.", modulos: ["planejamento-frentes", "obra360"] },
  {
    fala: "Uso muitas planilhas no escritório.",
    modulos: ["fluxodre-desktop", "colaboradores-documentos"],
  },
  { fala: "Tenho dificuldade para saber quanto cada obra custa.", modulos: ["dre-custos"] },
  { fala: "Perco muito tempo conferindo extrato.", modulos: ["artisys-finance"] },
  {
    fala: "Faço um PIX que paga várias coisas ao mesmo funcionário.",
    modulos: ["artisys-finance"],
  },
  { fala: "Quero treinar melhor minha equipe.", modulos: ["universidade"] },
  {
    fala: "Minha equipe tem dificuldade de leitura e matemática.",
    modulos: ["universidade", "jogos"],
  },
  { fala: "Preciso padronizar as verificações da obra.", modulos: ["checklists"] },
  { fala: "Não tenho histórico do que aconteceu na obra.", modulos: ["gestao-obras", "obra360"] },
];

function retrievedModules(fala: string): Set<string> {
  const signals = localExtraction([fala], FIELD_SYNONYMS);
  const query = signalsToQuery(signals, [fala]);
  const results = index.search(query, { topK: TOP_K, minScore: 0 });
  return new Set(results.map((r) => r.chunk.module));
}

describe("avaliação de recuperação (golden set, sem LLM)", () => {
  it.each(GOLDEN)("recupera ao menos um módulo esperado para: $fala", ({ fala, modulos }) => {
    const got = retrievedModules(fala);
    expect(modulos.some((m) => got.has(m))).toBe(true);
  });

  it("recall@k médio (qualquer módulo esperado) fica acima de 0.9", () => {
    const hits = GOLDEN.filter(({ fala, modulos }) => {
      const got = retrievedModules(fala);
      return modulos.some((m) => got.has(m));
    }).length;
    expect(hits / GOLDEN.length).toBeGreaterThanOrEqual(0.9);
  });

  it("recall estrito (TODOS os módulos esperados) fica acima de 0.5", () => {
    const strict = GOLDEN.filter(({ fala, modulos }) => {
      const got = retrievedModules(fala);
      return modulos.every((m) => got.has(m));
    }).length;
    expect(strict / GOLDEN.length).toBeGreaterThanOrEqual(0.5);
  });
});
