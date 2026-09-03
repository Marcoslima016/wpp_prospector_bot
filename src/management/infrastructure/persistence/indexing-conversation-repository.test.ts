import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversationRepositoryPort } from "../../../conversation-engine/application/ports/conversation-repository.port.ts";
import { Conversation } from "../../../conversation-engine/domain/conversation.ts";
import { openDatabase } from "../../../shared/persistence/sqlite/open-database.ts";
import type { Logger } from "../../application/ports/logger.port.ts";
import { buildConversation } from "../../test-support/conversation-fixtures.ts";
import { ConversationIndexProjection } from "./conversation-index-projection.ts";
import { ConversationIndexQueries } from "./conversation-index-queries.ts";
import { IndexingConversationRepository } from "./indexing-conversation-repository.ts";

let db: DatabaseSync | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

const logger: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

class InMemoryRepository implements ConversationRepositoryPort {
  readonly store = new Map<string, Conversation>();
  readonly saved: string[] = [];

  load(leadPhone: string): Promise<Conversation | null> {
    return Promise.resolve(this.store.get(leadPhone) ?? null);
  }
  save(conversation: Conversation): Promise<void> {
    this.saved.push(conversation.leadPhone);
    this.store.set(conversation.leadPhone, conversation);
    return Promise.resolve();
  }
  findConversationsWithPendingInbound(): Promise<Conversation[]> {
    return Promise.resolve([...this.store.values()].filter((c) => c.pendingInboundTurns.length > 0));
  }
}

describe("IndexingConversationRepository", () => {
  it("save delega ao repositório real e atualiza a projeção", async () => {
    db = openDatabase(":memory:");
    const inner = new InMemoryRepository();
    const projection = new ConversationIndexProjection(db);
    const repo = new IndexingConversationRepository(inner, projection, logger);

    await repo.save(buildConversation({ leadPhone: "+5511900000001", intent: "interested" }));

    expect(inner.saved).toEqual(["+5511900000001"]);
    const page = new ConversationIndexQueries(db).list({ limit: 10 });
    expect(page.items.map((i) => i.leadPhone)).toEqual(["+5511900000001"]);
  });

  it("uma conversa nova passa a ser retornada pelas queries de listagem", async () => {
    db = openDatabase(":memory:");
    const inner = new InMemoryRepository();
    const repo = new IndexingConversationRepository(
      inner,
      new ConversationIndexProjection(db),
      logger,
    );
    const queries = new ConversationIndexQueries(db);

    expect(queries.list({ limit: 10 }).items).toHaveLength(0);
    await repo.save(buildConversation({ leadPhone: "+5511900000002" }));
    expect(queries.list({ limit: 10 }).items.map((i) => i.leadPhone)).toEqual(["+5511900000002"]);
  });

  it("falha ao indexar é logada e não propaga; o save do arquivo é preservado", async () => {
    const inner = new InMemoryRepository();
    const brokenProjection = {
      upsertFromConversation: () => {
        throw new Error("boom");
      },
    } as unknown as ConversationIndexProjection;
    const warn = vi.fn();
    const repo = new IndexingConversationRepository(inner, brokenProjection, {
      info: vi.fn(),
      warn,
      error: vi.fn(),
    });

    await expect(
      repo.save(buildConversation({ leadPhone: "+5511900000003" })),
    ).resolves.toBeUndefined();
    expect(inner.saved).toEqual(["+5511900000003"]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("load e findConversationsWithPendingInbound apenas delegam", async () => {
    db = openDatabase(":memory:");
    const inner = new InMemoryRepository();
    const repo = new IndexingConversationRepository(
      inner,
      new ConversationIndexProjection(db),
      logger,
    );

    await repo.save(buildConversation({ leadPhone: "+5511900000004", pendingInbound: true }));
    await repo.save(buildConversation({ leadPhone: "+5511900000005" }));

    expect(await repo.load("+5511900000004")).toBe(inner.store.get("+5511900000004"));
    expect(await repo.load("+5519999999999")).toBeNull();

    const pending = await repo.findConversationsWithPendingInbound();
    expect(pending.map((c) => c.leadPhone)).toEqual(["+5511900000004"]);
  });
});
