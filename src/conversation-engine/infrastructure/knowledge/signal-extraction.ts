import { expandWithSynonyms, tokenize } from "./tokenizer.pt-br.ts";

/**
 * Sinais de busca extraídos das mensagens do lead. NÃO inclui intenção nem
 * qualificação — essas continuam sendo responsabilidade exclusiva da chamada
 * final que gera a `BotDecision`.
 */
export interface ExtractionSignals {
  /** Assuntos/temas mencionados (ex.: "controle de presença", "custo por obra"). */
  temas: string[];
  /** Dores/necessidades declaradas ou implícitas (ex.: "não sabe o que a equipe faz"). */
  dores: string[];
  /** Ids ou nomes de módulos que provavelmente atendem o lead. */
  modulosProvaveis: string[];
}

/** Prompt da chamada #1 (extração de sinais de busca). */
export const EXTRACTION_SYSTEM_PROMPT = [
  "Você é um extrator de sinais de busca para um sistema de recuperação de",
  "conhecimento comercial sobre o ecossistema Obra na Mão / FluxoDRE (gestão para",
  "construção civil).",
  "",
  "A partir das mensagens mais recentes do lead (e do histórico, se houver),",
  "identifique:",
  "- temas: assuntos concretos mencionados ou implícitos;",
  "- dores: problemas, necessidades ou dificuldades do lead, em linguagem de negócio;",
  "- modulosProvaveis: módulos que provavelmente atendem o lead, em palavras-chave",
  "  (ex.: 'presença', 'frentes', 'DRE', 'conciliação financeira', 'universidade').",
  "",
  "Regras:",
  "- Extraia só o que dá para inferir das mensagens; não invente.",
  "- Se a mensagem for vaga (ex.: 'oi', 'vi o anúncio'), retorne listas vazias.",
  "- NÃO classifique intenção, temperatura, qualificação ou próximo passo — isso",
  "  não é sua função.",
  "- Responda apenas com o objeto JSON no formato exigido, nada além disso.",
].join("\n");

/**
 * JSON Schema da saída da extração — subconjunto aceito pela Anthropic em
 * `output_config.format` (sem `type` array, sem `minLength`/`maxLength`,
 * `additionalProperties: false`, tudo em `required`).
 */
export const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    temas: {
      type: "array",
      items: { type: "string" },
      description: "Assuntos mencionados ou implícitos.",
    },
    dores: {
      type: "array",
      items: { type: "string" },
      description: "Problemas/necessidades do lead.",
    },
    modulosProvaveis: {
      type: "array",
      items: { type: "string" },
      description: "Palavras-chave de módulos que provavelmente atendem o lead.",
    },
  },
  required: ["temas", "dores", "modulosProvaveis"],
} as const;

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

/**
 * Interpreta a resposta bruta da chamada de extração. Retorna `null` quando o
 * texto não é JSON válido ou não tem nenhum dos campos esperados — o caller
 * então cai para `localExtraction`.
 */
export function parseExtractionSignals(text: string): ExtractionSignals | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  const signals: ExtractionSignals = {
    temas: asStringArray(record.temas),
    dores: asStringArray(record.dores),
    modulosProvaveis: asStringArray(record.modulosProvaveis),
  };

  return signals;
}

/** `true` quando não há nenhum sinal aproveitável para montar a query. */
export function isEmptySignals(signals: ExtractionSignals): boolean {
  return (
    signals.temas.length === 0 &&
    signals.dores.length === 0 &&
    signals.modulosProvaveis.length === 0
  );
}

/**
 * Extração local determinística (fallback): usa o próprio texto das mensagens e
 * a expansão por sinônimos/jargão. É o comportamento da "Opção A" do design.
 */
export function localExtraction(
  messages: string[],
  synonyms: Record<string, string[]>,
): ExtractionSignals {
  const joined = messages.join(" \n ");
  const modulos = [...new Set(expandWithSynonyms(joined, synonyms))];
  const temas = [...new Set(tokenize(joined))];

  return { temas, dores: [], modulosProvaveis: modulos };
}

/** Compõe a string de query léxica a partir dos sinais + do texto original. */
export function signalsToQuery(signals: ExtractionSignals, rawMessages: string[]): string {
  return [...rawMessages, ...signals.temas, ...signals.dores, ...signals.modulosProvaveis]
    .join(" \n ")
    .trim();
}
