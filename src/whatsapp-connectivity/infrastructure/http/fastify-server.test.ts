import { createHmac } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedAdminConfig } from "../../../management/infrastructure/config/env.ts";
import { InMemoryConversationRepository } from "../../../management/test-support/in-memory-conversation-repository.ts";
import { openDatabase } from "../../../shared/persistence/sqlite/open-database.ts";
import type { HandleInboundMessageUseCase } from "../../application/use-cases/handle-inbound-message.use-case.ts";
import type { HandleMessageStatusUpdateUseCase } from "../../application/use-cases/handle-message-status-update.use-case.ts";
import { buildFastifyServer } from "./fastify-server.ts";

const APP_SECRET = "test-app-secret";
const VERIFY_TOKEN = "verify-token";

const webhookDeps = {
  handleInboundMessage: { execute: vi.fn(async () => {}) } as unknown as HandleInboundMessageUseCase,
  handleMessageStatusUpdate: {
    execute: vi.fn(async () => {}),
  } as unknown as HandleMessageStatusUpdateUseCase,
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  webhookVerifyToken: VERIFY_TOKEN,
  appSecret: APP_SECRET,
};

let db: DatabaseSync | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

function adminDeps() {
  db = openDatabase(":memory:");
  const config: ResolvedAdminConfig = {
    accessSecret: "a",
    sessionSecret: "s",
    sessionTtlMs: 1000,
    webDistDir: "./__no_dist__",
  };
  return { config, db, repository: new InMemoryConversationRepository(), logger: webhookDeps.logger };
}

function signature(body: string): string {
  return `sha256=${createHmac("sha256", APP_SECRET).update(Buffer.from(body)).digest("hex")}`;
}

describe("buildFastifyServer", () => {
  it("sem admin: nenhuma rota /admin existe (404) e o webhook responde", async () => {
    const app = buildFastifyServer({ webhook: webhookDeps });
    await app.ready();

    expect((await app.inject({ method: "GET", url: "/admin/api/stats/overview" })).statusCode).toBe(
      404,
    );

    const verify = await app.inject({
      method: "GET",
      url: `/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=xyz`,
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.body).toBe("xyz");

    await app.close();
  });

  it("com admin: /admin/api existe mas exige sessão (401); o webhook ainda valida a assinatura", async () => {
    const app = buildFastifyServer({ webhook: webhookDeps, admin: adminDeps() });
    await app.ready();

    expect((await app.inject({ method: "GET", url: "/admin/api/stats/overview" })).statusCode).toBe(
      401,
    );

    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    const bad = await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp",
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=deadbeef" },
      payload: body,
    });
    expect(bad.statusCode).toBe(401);

    const good = await app.inject({
      method: "POST",
      url: "/webhooks/whatsapp",
      headers: { "content-type": "application/json", "x-hub-signature-256": signature(body) },
      payload: body,
    });
    expect(good.statusCode).toBe(200);

    await app.close();
  });
});
