import type { DatabaseSync } from "node:sqlite";
import Fastify, { type FastifyInstance } from "fastify";
import type { Conversation } from "../../conversation-engine/domain/conversation.ts";
import { openDatabase } from "../../shared/persistence/sqlite/open-database.ts";
import type { Logger } from "../application/ports/logger.port.ts";
import type { ResolvedAdminConfig } from "../infrastructure/config/env.ts";
import { registerAdminRoutes } from "../infrastructure/http/register-admin-routes.ts";
import { ConversationIndexProjection } from "../infrastructure/persistence/conversation-index-projection.ts";
import { IndexingConversationRepository } from "../infrastructure/persistence/indexing-conversation-repository.ts";
import { InMemoryConversationRepository } from "./in-memory-conversation-repository.ts";

export const TEST_ACCESS_SECRET = "test-access-secret";
export const TEST_SESSION_SECRET = "test-session-secret";
export const TEST_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

export interface AdminTestApp {
  app: FastifyInstance;
  db: DatabaseSync;
  inner: InMemoryConversationRepository;
  repository: IndexingConversationRepository;
  now: { value: Date };
  /** Faz login e devolve o header `cookie` da sessão. */
  login: () => Promise<string>;
  close: () => Promise<void>;
}

export interface BuildAdminTestAppOptions {
  /** Conversas a persistir via o repositório decorado (alimentam a projeção). */
  conversations?: Conversation[];
  webDistDir?: string;
  now?: Date;
}

export async function buildAdminTestApp(
  options: BuildAdminTestAppOptions = {},
): Promise<AdminTestApp> {
  const db = openDatabase(":memory:");
  const now = { value: options.now ?? new Date("2026-09-02T12:00:00.000Z") };

  const inner = new InMemoryConversationRepository();
  const projection = new ConversationIndexProjection(db, () => now.value);
  const repository = new IndexingConversationRepository(inner, projection, silentLogger);

  for (const conversation of options.conversations ?? []) {
    await repository.save(conversation);
  }

  const config: ResolvedAdminConfig = {
    accessSecret: TEST_ACCESS_SECRET,
    sessionSecret: TEST_SESSION_SECRET,
    sessionTtlMs: TEST_SESSION_TTL_MS,
    webDistDir: options.webDistDir ?? "./__no_such_dist__",
  };

  const app = Fastify();
  await app.register(registerAdminRoutes, {
    prefix: "/admin",
    config,
    db,
    repository,
    logger: silentLogger,
    clock: () => now.value,
  });
  await app.ready();

  async function login(): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/admin/api/session",
      payload: { secret: TEST_ACCESS_SECRET },
    });
    const setCookie = res.headers["set-cookie"];
    const raw = Array.isArray(setCookie) ? (setCookie[0] ?? "") : String(setCookie);
    return raw.split(";")[0] ?? "";
  }

  return {
    app,
    db,
    inner,
    repository,
    now,
    login,
    close: async () => {
      await app.close();
      db.close();
    },
  };
}
