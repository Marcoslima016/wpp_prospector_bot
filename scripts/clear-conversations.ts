/**
 * Limpa o histórico de conversas da aplicação: apaga os arquivos `*.json` (um
 * por lead) e eventuais `*.tmp` de escrita atômica interrompida dentro de
 * `CONVERSATIONS_DIR`. O diretório em si é preservado — o
 * `FileConversationRepository` o recria no próximo `save`.
 *
 * Uso: node --experimental-transform-types scripts/clear-conversations.ts [dir]
 */
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? process.env.CONVERSATIONS_DIR ?? "./data/conversations";

let entries: string[];
try {
  entries = readdirSync(dir);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") {
    console.log(`Nada a limpar: ${dir} não existe.`);
    process.exit(0);
  }
  throw error;
}

const targets = entries.filter((name) => name.endsWith(".json") || name.endsWith(".tmp"));
for (const name of targets) {
  rmSync(join(dir, name), { force: true });
}

console.log(`Histórico de conversas limpo em ${dir} (${targets.length} arquivo(s) removido(s)).`);
