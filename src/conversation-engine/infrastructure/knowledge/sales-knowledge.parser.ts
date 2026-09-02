import {
  isModuleId,
  moduleTier,
  MODULE_TIERS,
  type ModuleTier,
} from "../../domain/product-catalog.ts";
import { KNOWLEDGE_KINDS, type KnowledgeChunk, type KnowledgeKind } from "./knowledge.types.ts";

/** Falha ao interpretar `sales-knowledge.md` (formato inválido ou metadados ausentes). */
export class KnowledgeParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeParseError";
  }
}

const REQUIRED_META = ["id", "module", "tier", "kind"] as const;
const DELIMITER = /^={4,}\s*$/;
const META_LINE = /^([a-zA-Z_]+):\s*(.*)$/;

/**
 * Interpreta o markdown curado da base comercial numa lista de trechos com
 * metadados. Cada trecho começa numa linha `====`, seguida de linhas
 * `chave: valor`, uma linha em branco e o corpo até o próximo `====`.
 *
 * Lança `KnowledgeParseError` — com mensagem descritiva — se nenhum trecho for
 * reconhecido, se um trecho não tiver os metadados obrigatórios (`id`, `module`,
 * `tier`, `kind`), se um valor de metadado for inválido, se o corpo estiver
 * vazio ou se houver `id` duplicado.
 */
export function parseSalesKnowledge(markdown: string): KnowledgeChunk[] {
  const lines = markdown.split(/\r?\n/);
  const delimIndexes: number[] = [];
  lines.forEach((line, i) => {
    if (DELIMITER.test(line)) delimIndexes.push(i);
  });

  if (delimIndexes.length === 0) {
    throw new KnowledgeParseError(
      "sales-knowledge.md: nenhum trecho encontrado (esperado ao menos um delimitador '====')",
    );
  }

  const chunks: KnowledgeChunk[] = [];
  const seenIds = new Set<string>();

  for (let d = 0; d < delimIndexes.length; d++) {
    const start = delimIndexes[d]! + 1;
    const end = d + 1 < delimIndexes.length ? delimIndexes[d + 1]! : lines.length;
    const segment = lines.slice(start, end);
    const position = d + 1;

    const meta: Record<string, string> = {};
    let cursor = 0;
    for (; cursor < segment.length; cursor++) {
      const line = segment[cursor]!;
      if (line.trim() === "") {
        cursor++;
        break;
      }
      const match = META_LINE.exec(line);
      if (!match) {
        throw new KnowledgeParseError(
          `sales-knowledge.md: trecho #${position}: linha de metadado inválida: "${line}"`,
        );
      }
      meta[match[1]!.toLowerCase()] = match[2]!.trim();
    }

    const body = segment.slice(cursor).join("\n").trim();
    const label = meta.id ? `"${meta.id}"` : `#${position}`;

    for (const key of REQUIRED_META) {
      if (!meta[key]) {
        throw new KnowledgeParseError(
          `sales-knowledge.md: trecho ${label}: metadado obrigatório ausente: "${key}"`,
        );
      }
    }

    if (!body) {
      throw new KnowledgeParseError(`sales-knowledge.md: trecho ${label}: corpo vazio`);
    }

    const id = meta.id!;
    if (seenIds.has(id)) {
      throw new KnowledgeParseError(`sales-knowledge.md: id de trecho duplicado: "${id}"`);
    }
    seenIds.add(id);

    const moduleValue = meta.module!;
    if (moduleValue !== "geral" && !isModuleId(moduleValue)) {
      throw new KnowledgeParseError(
        `sales-knowledge.md: trecho ${label}: module desconhecido: "${moduleValue}"`,
      );
    }

    const tier = meta.tier as ModuleTier;
    if (!MODULE_TIERS.includes(tier)) {
      throw new KnowledgeParseError(
        `sales-knowledge.md: trecho ${label}: tier inválido: "${meta.tier}" (use ${MODULE_TIERS.join(" | ")})`,
      );
    }

    if (moduleValue !== "geral" && tier !== moduleTier(moduleValue)) {
      throw new KnowledgeParseError(
        `sales-knowledge.md: trecho ${label}: tier "${tier}" incoerente com o módulo "${moduleValue}" (esperado "${moduleTier(moduleValue)}")`,
      );
    }
    if (moduleValue === "geral" && tier !== "geral") {
      throw new KnowledgeParseError(
        `sales-knowledge.md: trecho ${label}: module "geral" exige tier "geral"`,
      );
    }

    const kind = meta.kind as KnowledgeKind;
    if (!KNOWLEDGE_KINDS.includes(kind)) {
      throw new KnowledgeParseError(
        `sales-knowledge.md: trecho ${label}: kind inválido: "${meta.kind}" (use ${KNOWLEDGE_KINDS.join(" | ")})`,
      );
    }

    const explicitPinned = parsePinned(meta.pinned, label);
    const pinned = explicitPinned || kind === "guardrail" || kind === "preco";
    const title = meta.title ? meta.title : null;

    chunks.push({
      id,
      module: moduleValue as KnowledgeChunk["module"],
      tier,
      kind,
      pinned,
      title,
      body,
      text: title ? `${title}\n\n${body}` : body,
    });
  }

  return chunks;
}

function parsePinned(value: string | undefined, label: string): boolean {
  if (value === undefined || value === "") return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new KnowledgeParseError(
    `sales-knowledge.md: trecho ${label}: pinned deve ser "true" ou "false", recebido "${value}"`,
  );
}
