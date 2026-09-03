import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeadSerialQueue } from "../conversation-engine/infrastructure/inbound/lead-serial-queue.ts";
import type { HandleInboundMessageUseCase } from "../whatsapp-connectivity/application/use-cases/handle-inbound-message.use-case.ts";
import type { HandleMessageStatusUpdateUseCase } from "../whatsapp-connectivity/application/use-cases/handle-message-status-update.use-case.ts";
import { buildFastifyServer } from "../whatsapp-connectivity/infrastructure/http/fastify-server.ts";
import { openDatabase } from "../shared/persistence/sqlite/open-database.ts";
import type { Logger } from "./application/ports/logger.port.ts";
import type { ResolvedAdminConfig } from "./infrastructure/config/env.ts";
import { ConversationIndexProjection } from "./infrastructure/persistence/conversation-index-projection.ts";
import { IndexingConversationRepository } from "./infrastructure/persistence/indexing-conversation-repository.ts";
import { SqliteAdminActionAudit } from "./infrastructure/persistence/sqlite-admin-action-audit.ts";
import { SqliteLeadRepository } from "./infrastructure/persistence/sqlite-lead-repository.ts";
import { buildConversation } from "./test-support/conversation-fixtures.ts";
import { FakeSendTemplateMessageUseCase } from "./test-support/fake-send-template-message.ts";
import { FakeSendTextMessageUseCase } from "./test-support/fake-send-text-message.ts";
import { InMemoryConversationRepository } from "./test-support/in-memory-conversation-repository.ts";

const ACCESS_SECRET = "actions-integration-access-secret";
const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };
const NOW = new Date("2026-09-02T12:00:00.000Z");

const OPEN_PHONE = "+5511900000001"; // inbound 60s antes de NOW → janela aberta
const STALE_PHONE = "+5511900000002"; // inbound ~36h antes de NOW → janela fechada

const config: ResolvedAdminConfig = {
  accessSecret: ACCESS_SECRET,
  sessionSecret: "actions-integration-session-secret",
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
let sendText: FakeSendTextMessageUseCase;

beforeEach(async () => {
  db = openDatabase(":memory:");
  const repository = new IndexingConversationRepository(
    new InMemoryConversationRepository(),
    new ConversationIndexProjection(db, () => NOW),
    silent,
  );
  await repository.save(buildConversation({ leadPhone: OPEN_PHONE, at: NOW }));
  await repository.save(
    buildConversation({ leadPhone: STALE_PHONE, at: new Date("2026-09-01T00:00:00.000Z") }),
  );

  sendText = new FakeSendTextMessageUseCase();
  app = buildFastifyServer({
    webhook,
    admin: {
      config,
      db,
      repository,
      sendText: sendText.asUseCase(),
      sendTemplate: new FakeSendTemplateMessageUseCase().asUseCase(),
      leads: new SqliteLeadRepository(db, silent, () => NOW),
      queue: new LeadSerialQueue(),
      audit: new SqliteAdminActionAudit(db, silent, () => NOW),
      logger: silent,
      clock: () => NOW,
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

function detailOf(cookie: string, phone: string) {
  return app.inject({ method: "GET", url: `/admin/api/conversations/${phone}`, headers: { cookie } });
}

function auditActions(): string[] {
  return (
    db.prepare("SELECT action FROM admin_action_events ORDER BY id").all() as Array<{
      action: string;
    }>
  ).map((r) => r.action);
}

describe("Ações de operação sobre conversas (integração)", () => {
  it("handoff → mensagem avulsa → resume, com auditoria por ação", async () => {
    const cookie = await loginCookie();

    const handoff = await app.inject({
      method: "POST",
      url: `/admin/api/conversations/${OPEN_PHONE}/handoff`,
      headers: { cookie },
    });
    expect(handoff.statusCode).toBe(200);
    expect(handoff.json().state).toBe("awaitingHuman");
    expect((await detailOf(cookie, OPEN_PHONE)).json().state).toBe("awaitingHuman");

    const message = await app.inject({
      method: "POST",
      url: `/admin/api/conversations/${OPEN_PHONE}/messages`,
      headers: { cookie },
      payload: { text: "Oi, aqui é o time. Como posso ajudar?" },
    });
    expect(message.statusCode).toBe(200);
    expect(message.json()).toMatchObject({
      sent: true,
      turn: { direction: "outbound", origin: "operator" },
    });
    expect(sendText.calls).toEqual([
      { to: OPEN_PHONE, body: "Oi, aqui é o time. Como posso ajudar?" },
    ]);
    const turnsAfterMessage = (await detailOf(cookie, OPEN_PHONE)).json().turns as Array<{
      origin?: string;
      text: string;
    }>;
    expect(turnsAfterMessage.at(-1)).toMatchObject({
      origin: "operator",
      text: "Oi, aqui é o time. Como posso ajudar?",
    });

    const resume = await app.inject({
      method: "POST",
      url: `/admin/api/conversations/${OPEN_PHONE}/resume`,
      headers: { cookie },
    });
    expect(resume.statusCode).toBe(200);
    expect(resume.json().state).toBe("active");
    expect((await detailOf(cookie, OPEN_PHONE)).json().state).toBe("active");

    expect(auditActions()).toEqual(["handoff", "send-message", "resume"]);
  });

  it("cada endpoint de ação exige sessão (401 sem cookie)", async () => {
    for (const path of [
      `/admin/api/conversations/${OPEN_PHONE}/handoff`,
      `/admin/api/conversations/${OPEN_PHONE}/resume`,
      `/admin/api/conversations/${OPEN_PHONE}/messages`,
    ]) {
      const res = await app.inject({ method: "POST", url: path, payload: { text: "x" } });
      expect(res.statusCode).toBe(401);
    }
    expect(auditActions()).toHaveLength(0);
  });

  it("mensagem avulsa com a janela de 24 h fechada → 409, sem enviar nem registrar turno", async () => {
    const cookie = await loginCookie();

    const res = await app.inject({
      method: "POST",
      url: `/admin/api/conversations/${STALE_PHONE}/messages`,
      headers: { cookie },
      payload: { text: "oi" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().reason).toEqual(expect.any(String));
    expect(sendText.calls).toHaveLength(0);
    const turns = (await detailOf(cookie, STALE_PHONE)).json().turns as Array<{ origin?: string }>;
    expect(turns.some((t) => t.origin === "operator")).toBe(false);
    expect(auditActions()).toHaveLength(0);
  });

  it("conversa inexistente → 404 em cada endpoint de ação", async () => {
    const cookie = await loginCookie();

    for (const path of [
      "/admin/api/conversations/+5511999999999/handoff",
      "/admin/api/conversations/+5511999999999/resume",
      "/admin/api/conversations/+5511999999999/messages",
    ]) {
      const res = await app.inject({
        method: "POST",
        url: path,
        headers: { cookie },
        payload: { text: "oi" },
      });
      expect(res.statusCode).toBe(404);
    }
  });
});
