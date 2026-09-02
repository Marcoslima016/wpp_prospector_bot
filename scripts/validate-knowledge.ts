/**
 * Valida a base de conhecimento comercial (`sales-knowledge.md` + `pricing.md`):
 * roda o parser, checa os metadados por trecho e a contagem mínima, e constrói o
 * índice. Sai com código != 0 em qualquer falha. Deve rodar no CI antes do
 * deploy — torna a falha de boot (fail-fast) quase impossível em runtime.
 *
 * Uso: node --experimental-transform-types scripts/validate-knowledge.ts [dir]
 */
import {
  loadKnowledge,
  MIN_KNOWLEDGE_CHUNKS,
} from "../src/conversation-engine/infrastructure/knowledge/knowledge-loader.ts";

const dir =
  process.argv[2] ??
  process.env.KNOWLEDGE_DIR ??
  "./src/conversation-engine/infrastructure/knowledge";

try {
  const { chunks } = loadKnowledge(dir);

  const byKind = new Map<string, number>();
  const byModule = new Map<string, number>();
  for (const chunk of chunks) {
    byKind.set(chunk.kind, (byKind.get(chunk.kind) ?? 0) + 1);
    byModule.set(chunk.module, (byModule.get(chunk.module) ?? 0) + 1);
  }

  const pinned = chunks.filter((c) => c.pinned).length;

  console.log(`Base de conhecimento OK (${dir})`);
  console.log(`  trechos: ${chunks.length} (mínimo ${MIN_KNOWLEDGE_CHUNKS})`);
  console.log(`  pinned:  ${pinned}`);
  console.log(`  variável: ${chunks.length - pinned}`);
  console.log(`  por kind: ${[...byKind.entries()].map(([k, n]) => `${k}=${n}`).join(", ")}`);
  console.log(`  módulos cobertos: ${[...byModule.keys()].sort().join(", ")}`);
} catch (error) {
  console.error("Validação da base de conhecimento FALHOU:");
  console.error(`  ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
