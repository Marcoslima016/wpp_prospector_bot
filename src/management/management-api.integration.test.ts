import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HandleInboundMessageUseCase } from "../whatsapp-connectivity/application/use-cases/handle-inbound-message.use-case.ts";
import type { HandleMessageStatusUpdateUseCase } from "../whatsapp-connectivity/application/use-cases/handle-message-status-update.use-case.ts";
import { buildFastifyServer } from "../whatsapp-connectivity/infrastructure/http/fastify-server.ts";
import { openDatabase } from "../shared/persistence/sqlite/open-database.ts";
import type { Logger } from "./application/ports/logger.port.ts";
import type { ResolvedAdminConfig } from "./infrastructure/config/env.ts";
import { LeadSerialQueue } from "../conversation-engine/infrastructure/inbound/lead-serial-queue.ts";
import { ConversationIndexProjection } from "./infrastructure/persistence/conversation-index-projection.ts";
import { IndexingConversationRepository } from "./infrastructure/persistence/indexing-conversation-repository.ts";
import { SqliteAdminActionAudit } from "./infrastructure/persistence/sqlite-admin-action-audit.ts";
import { SqliteLeadRepository } from "./infrastructure/persistence/sqlite-lead-repository.ts";
import { buildConversation } from "./test-support/conversation-fixtures.ts";
import { FakeSendTemplateMessageUseCase } from "./test-support/fake-send-template-message.ts";
import { FakeSendTextMessageUseCase } from "./test-support/fake-send-text-message.ts";
import { InMemoryConversationRepository } from "./test-support/in-memory-conversation-repository.ts";

const ACCESS_SECRET = "integration-access-secret";
const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

const config: ResolvedAdminConfig = {
  accessSecret: ACCESS_SECRET,
  sessionSecret: "integration-session-secret",
  sessionTtlMs: 60_000,
  webDistDir: "./__no_dist__",
  firstContactTemplate: { name: "primeiro_contato", lang: "pt_BR", paramKeys: [] },
};

const webhook = {
  handleInboundMessage: { execute: vi.fn(async () => {}) } as unknown as HandleInboundMessageUseCase,
  handleMessageStatusUpdate: {
    execute: vi.fn(async () => {}),
  } as unknown as HandleMessageStatusUpdateUseCase,
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  webhookVerifyToken: "vt",
  appSecret: "as",
};

let db: DatabaseSync;
let app: ReturnType<typeof buildFastifyServer>;

beforeEach(async () => {
  db = openDatabase(":memory:");
  const repository = new IndexingConversationRepository(
    new InMemoryConversationRepository(),
    new ConversationIndexProjection(db),
    silent,
  );
  await repository.save(
    buildConversation({
      leadPhone: "+5511900000001",
      at: new Date("2026-09-01T10:00:00.000Z"),
      intent: "interested",
    }),
  );
  await repository.save(
    buildConversation({
      leadPhone: "+5511900000002",
      at: new Date("2026-09-02T10:00:00.000Z"),
      intent: "needs_more_info",
      pendingInbound: true,
    }),
  );

  app = buildFastifyServer({
    webhook,
    admin: {
      config,
      db,
      repository,
      sendText: new FakeSendTextMessageUseCase().asUseCase(),
      sendTemplate: new FakeSendTemplateMessageUseCase().asUseCase(),
      leads: new SqliteLeadRepository(db, silent),
      queue: new LeadSerialQueue(),
      audit: new SqliteAdminActionAudit(db, silent),
      logger: silent,
    },
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
});

async function loginCookie(): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/admin/api/session",
    payload: { secret: ACCESS_SECRET },
  });
  expect(res.statusCode).toBe(200);
  return String(res.headers["set-cookie"]).split(";")[0] ?? "";
}

describe("API de gestão /admin (integração)", () => {
  it("fluxo login → conversas → detalhe → overview → logout → 401", async () => {
    const cookie = await loginCookie();

    const list = await app.inject({
      method: "GET",
      url: "/admin/api/conversations",
      headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items.map((i: { leadPhone: string }) => i.leadPhone)).toEqual([
      "+5511900000002",
      "+5511900000001",
    ]);

    const detail = await app.inject({
      method: "GET",
      url: "/admin/api/conversations/+5511900000001",
      headers: { cookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().leadPhone).toBe("+5511900000001");

    const overview = await app.inject({
      method: "GET",
      url: "/admin/api/stats/overview",
      headers: { cookie },
    });
    expect(overview.json()).toEqual({
      conversationsByState: { active: 2, ended: 0, awaitingHuman: 0 },
      totalLeads: 2,
      pendingInbound: 1,
    });

    const logout = await app.inject({
      method: "DELETE",
      url: "/admin/api/session",
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(204);

    const afterLogout = await app.inject({
      method: "GET",
      url: "/admin/api/conversations",
      headers: { cookie: "admin_session=" },
    });
    expect(afterLogout.statusCode).toBe(401);
  });

  it("cada endpoint protegido exige sessão (401 sem cookie)", async () => {
    for (const url of [
      "/admin/api/conversations",
      "/admin/api/conversations/+5511900000001",
      "/admin/api/stats/overview",
      "/admin/api/stats/consumption?from=2026-09-01T00:00:00.000Z&to=2026-09-02T00:00:00.000Z",
    ]) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    }
  });

  it("consumption devolve série vazia quando não há eventos", async () => {
    const cookie = await loginCookie();
    const res = await app.inject({
      method: "GET",
      url: "/admin/api/stats/consumption?from=2026-09-01T00:00:00.000Z&to=2026-09-30T00:00:00.000Z&groupBy=model",
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().rows).toEqual([]);
    expect(res.json().total.estimatedCostUsd).toBe(0);
  });
});
