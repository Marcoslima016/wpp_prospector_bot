import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildConversation } from "../../test-support/conversation-fixtures.ts";
import { buildAdminTestApp, type AdminTestApp } from "../../test-support/admin-test-app.ts";

const CONVERSATIONS = [
  buildConversation({ leadPhone: "+5511900000001", intent: "interested" }),
  buildConversation({ leadPhone: "+5511900000002", intent: "needs_more_info", pendingInbound: true }),
  buildConversation({ leadPhone: "+5511900000003", intent: "opt_out", end: true }),
];

let harness: AdminTestApp;
let cookie: string;

afterEach(async () => {
  await harness.close();
});

async function setup(conversations = CONVERSATIONS) {
  harness = await buildAdminTestApp({ conversations });
  cookie = await harness.login();
}

describe("GET /admin/api/stats/overview", () => {
  beforeEach(() => setup());

  it("sem sessão → 401", async () => {
    const res = await harness.app.inject({ method: "GET", url: "/admin/api/stats/overview" });
    expect(res.statusCode).toBe(401);
  });

  it("conta conversas por estado, total de leads e pendências", async () => {
    const res = await harness.app.inject({
      method: "GET",
      url: "/admin/api/stats/overview",
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      conversationsByState: { active: 2, ended: 1, awaitingHuman: 0 },
      totalLeads: 3,
      pendingInbound: 1,
    });
  });
});

describe("GET /admin/api/stats/overview (índice vazio)", () => {
  beforeEach(() => setup([]));

  it("responde zeros", async () => {
    const res = await harness.app.inject({
      method: "GET",
      url: "/admin/api/stats/overview",
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      conversationsByState: { active: 0, ended: 0, awaitingHuman: 0 },
      totalLeads: 0,
      pendingInbound: 0,
    });
  });
});

describe("GET /admin/api/stats/consumption", () => {
  beforeEach(() => setup());

  it("sem sessão → 401", async () => {
    const res = await harness.app.inject({
      method: "GET",
      url: "/admin/api/stats/consumption?from=2026-09-01T00:00:00.000Z&to=2026-09-02T00:00:00.000Z",
    });
    expect(res.statusCode).toBe(401);
  });

  it("intervalo sem eventos → série vazia 200", async () => {
    const res = await harness.app.inject({
      method: "GET",
      url: "/admin/api/stats/consumption?from=2026-09-01T00:00:00.000Z&to=2026-09-05T00:00:00.000Z&groupBy=day",
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.groupBy).toBe("day");
    expect(body.rows).toEqual([]);
    expect(body.total.inputTokens).toBe(0);
    expect(body.total.estimatedCostUsd).toBe(0);
  });

  it("query sem from/to → 400", async () => {
    const res = await harness.app.inject({
      method: "GET",
      url: "/admin/api/stats/consumption?groupBy=day",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
  });
});
