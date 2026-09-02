import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { KnowledgeParseError } from "./sales-knowledge.parser.ts";
import { KnowledgeLoadError, loadKnowledge, MIN_KNOWLEDGE_CHUNKS } from "./knowledge-loader.ts";

const REAL_DIR = dirname(fileURLToPath(import.meta.url));

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "knowledge-"));
  dirs.push(d);
  return d;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("loadKnowledge (fail-fast do boot)", () => {
  it("prepara a base real: índice + pinned + contagem acima do mínimo", () => {
    const bundle = loadKnowledge(REAL_DIR);

    expect(bundle.chunks.length).toBeGreaterThanOrEqual(MIN_KNOWLEDGE_CHUNKS);
    expect(bundle.pinnedContext).toContain("R$ 300");
    expect(bundle.index.variableChunks.length).toBeGreaterThan(0);
  });

  it("aborta quando o diretório não tem os arquivos", () => {
    expect(() => loadKnowledge(tempDir())).toThrow(KnowledgeLoadError);
  });

  it("aborta quando sales-knowledge.md está malformado", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "sales-knowledge.md"), "# sem trechos\n\nnada aqui");
    writeFileSync(join(dir, "pricing.md"), "# preços\nEssencial R$ 300");

    expect(() => loadKnowledge(dir)).toThrow(KnowledgeParseError);
  });

  it("aborta quando há poucos trechos (abaixo do mínimo)", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "sales-knowledge.md"),
      `====
id: posicionamento
module: geral
tier: geral
kind: visao
pinned: true

Ecossistema modular.

====
id: gestao
module: gestao-obras
tier: base
kind: funcionalidades

Organiza a obra.
`,
    );
    writeFileSync(join(dir, "pricing.md"), "# preços\nEssencial R$ 300");

    expect(() => loadKnowledge(dir)).toThrow(/esperado ao menos/);
  });

  it("aborta quando pricing.md está vazio", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "sales-knowledge.md"),
      "====\nid: x\nmodule: geral\ntier: geral\nkind: visao\n\nok\n",
    );
    writeFileSync(join(dir, "pricing.md"), "   \n");

    expect(() => loadKnowledge(dir)).toThrow(/pricing\.md está vazio/);
  });
});
