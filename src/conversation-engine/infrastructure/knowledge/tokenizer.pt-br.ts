/**
 * Tokenização PT-BR leve para a busca léxica: minúsculas, remoção de acentos,
 * stopwords e stemming de sufixos comuns (plural, gerúndio, infinitivo,
 * advérbios em -mente). O maior ganho de recall vem do mapa de sinônimos
 * (`synonyms.pt-br.ts`), não do stemmer — este é propositalmente conservador.
 */

const STOPWORDS: ReadonlySet<string> = new Set([
  "a",
  "o",
  "as",
  "os",
  "um",
  "uma",
  "uns",
  "umas",
  "de",
  "do",
  "da",
  "dos",
  "das",
  "em",
  "no",
  "na",
  "nos",
  "nas",
  "por",
  "para",
  "pra",
  "pro",
  "com",
  "sem",
  "sob",
  "sobre",
  "ao",
  "aos",
  "e",
  "ou",
  "mas",
  "que",
  "se",
  "ja",
  "nao",
  "sim",
  "eu",
  "voce",
  "vc",
  "ele",
  "ela",
  "nos",
  "eles",
  "elas",
  "meu",
  "minha",
  "meus",
  "minhas",
  "seu",
  "sua",
  "seus",
  "suas",
  "isso",
  "isto",
  "aquilo",
  "este",
  "esta",
  "esse",
  "essa",
  "aquele",
  "aquela",
  "as",
  "la",
  "aqui",
  "ali",
  "muito",
  "muita",
  "muitos",
  "muitas",
  "mais",
  "menos",
  "bem",
  "tambem",
  "so",
  "ainda",
  "quando",
  "onde",
  "como",
  "porque",
  "entao",
  "assim",
  "ter",
  "tem",
  "tenho",
  "temos",
  "tinha",
  "ser",
  "sou",
  "é",
  "e",
  "sao",
  "era",
  "estar",
  "esta",
  "estao",
  "estou",
  "foi",
  "vai",
  "vou",
  "fica",
  "faz",
  "fazer",
  "ta",
  "to",
  "pq",
  "oi",
  "ola",
  "obrigado",
  "obrigada",
  "tudo",
  "todo",
  "toda",
  "cada",
  "algum",
  "alguma",
  "nenhum",
  "meu",
  "dele",
  "dela",
  "num",
  "numa",
]);

/** Minúsculas + remoção de acentos/diacríticos. */
export function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function stem(token: string): string {
  let t = token;
  if (t.length > 6 && t.endsWith("mente")) t = t.slice(0, -5);
  if (t.length > 5 && t.endsWith("ndo")) t = t.slice(0, -3);
  // Plural: só o "s" final. Regras de "-es"/"-ões" são ambíguas (equipes→equipe,
  // não equip) — o mapa de sinônimos cobre os casos que sobram.
  if (t.length > 3 && t.endsWith("s")) t = t.slice(0, -1);
  if (t.length > 4 && t.endsWith("r")) t = t.slice(0, -1);
  return t;
}

/**
 * Quebra o texto em tokens normalizados e stemizados, descartando stopwords e
 * tokens de 1 caractere.
 */
export function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((raw) => raw.length > 1 && !STOPWORDS.has(raw))
    .map(stem)
    .filter((t) => t.length > 1);
}

/**
 * Expande um texto pelo mapa de sinônimos/jargão. Retorna os termos canônicos
 * adicionais (ainda não tokenizados) disparados por chaves de expressão
 * (substring do texto normalizado) ou por tokens isolados.
 */
export function expandWithSynonyms(text: string, synonyms: Record<string, string[]>): string[] {
  const normalized = normalize(text);
  const rawTokens = new Set(normalized.split(/[^a-z0-9]+/).filter(Boolean));
  const out: string[] = [];

  for (const [key, values] of Object.entries(synonyms)) {
    const isPhrase = key.includes(" ");
    if (isPhrase ? normalized.includes(key) : rawTokens.has(key)) {
      out.push(...values);
    }
  }

  return out;
}
