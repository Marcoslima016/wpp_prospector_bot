import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Conversation } from "../../domain/conversation.ts";
import type { ConversationRepositoryPort } from "../../application/ports/conversation-repository.port.ts";

/**
 * Persistência da conversa em um arquivo JSON por lead dentro de `conversationsDir`.
 * Escrita atômica (arquivo temporário + `rename`). Assume processo único — a
 * serialização por lead é garantida pelo coordenador de lote.
 */
export class FileConversationRepository implements ConversationRepositoryPort {
  constructor(private readonly conversationsDir: string) {}

  async load(leadPhone: string): Promise<Conversation | null> {
    const raw = await this.readFileOrNull(this.filePathFor(leadPhone));
    if (raw === null) return null;
    return Conversation.fromJSON(JSON.parse(raw));
  }

  async save(conversation: Conversation): Promise<void> {
    await mkdir(this.conversationsDir, { recursive: true });

    const finalPath = this.filePathFor(conversation.leadPhone);
    const tmpPath = `${finalPath}.${randomUUID()}.tmp`;
    const payload = JSON.stringify(conversation.toJSON(), null, 2);

    await writeFile(tmpPath, payload, "utf8");
    await rename(tmpPath, finalPath);
  }

  async findConversationsWithPendingInbound(): Promise<Conversation[]> {
    let entries: string[];
    try {
      entries = await readdir(this.conversationsDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }

    const conversations: Conversation[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const raw = await this.readFileOrNull(join(this.conversationsDir, entry));
      if (raw === null) continue;
      const conversation = Conversation.fromJSON(JSON.parse(raw));
      if (conversation.pendingInboundTurns.length > 0) {
        conversations.push(conversation);
      }
    }
    return conversations;
  }

  private filePathFor(leadPhone: string): string {
    const normalized = leadPhone.replace(/\D/g, "");
    return join(this.conversationsDir, `${normalized}.json`);
  }

  private async readFileOrNull(path: string): Promise<string | null> {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}
