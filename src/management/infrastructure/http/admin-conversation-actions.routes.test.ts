import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WhatsAppApiError } from "../../../whatsapp-connectivity/application/errors.ts";
import { buildConversation } from "../../test-support/conversation-fixtures.ts";
import { buildAdminTestApp, type AdminTestApp } from "../../test-support/admin-test-app.ts";

const OPEN_PHONE = "+5511900000001";
const CLOSED_PHONE = "+5511900000002";

let harness: AdminTestApp;
let cookie: string;

beforeEach(async () => {
  harness = await buildAdminTestApp({
    // `now` do harness = 2026-09-02T12:00:00Z. OPEN tem inbound 60s antes (janela aberta);
    // CLOSED tem inbound ~36h antes (janela fechada).
    conversations: [
      buildConversation({ leadPhone: OPEN_PHONE }),
      buildConversation({ leadPhone: CLOSED_PHONE, at: new Date("2026-09-01T00:00:00.000Z") }),
    ],
  });
  cookie = await harness.login();
});

afterEach(async () => {
  await harness.close();
});

function auditRows(): Array<{ action: string; lead_phone: string }> {
  return harness.db
    .prepare("SELECT action, lead_phone FROM admin_action_events ORDER BY id")
    .all() as unknown as Array<{ action: string; lead_phone: string }>;
}

describe("POST /admin/api/conversations/:leadPhone/handoff", () => {
  it("coloca a conversa em awaitingHuman e devolve o detalhe atualizado", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: `/admin/api/conversations/${OPEN_PHONE}/handoff`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ leadPhone: OPEN_PHONE, state: "awaitingHuman" });
    expect(auditRows()).toEqual([{ action: "handoff", lead_phone: OPEN_PHONE }]);
  });

  it("sem sessão → 401", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: `/admin/api/conversations/${OPEN_PHONE}/handoff`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("telefone inexistente → 404", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/admin/api/conversations/+5511999999999/handoff",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /admin/api/conversations/:leadPhone/resume", () => {
  it("devolve a conversa para active", async () => {
    await harness.app.inject({
      method: "POST",
      url: `/admin/api/conversations/${OPEN_PHONE}/handoff`,
      headers: { cookie },
    });

    const res = await harness.app.inject({
      method: "POST",
      url: `/admin/api/conversations/${OPEN_PHONE}/resume`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ state: "active" });
    expect(auditRows().map((r) => r.action)).toEqual(["handoff", "resume"]);
  });

  it("sem sessão → 401", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: `/admin/api/conversations/${OPEN_PHONE}/resume`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("telefone inexistente → 404", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/admin/api/conversations/+5511999999999/resume",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /admin/api/conversations/:leadPhone/messages", () => {
  it("dentro da janela: envia, devolve o turno do operador e o detalhe passa a mostrá-lo", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: `/admin/api/conversations/${OPEN_PHONE}/messages`,
      headers: { cookie },
      payload: { text: "Oi! Aqui é o time comercial." },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      sent: true,
      turn: { direction: "outbound", origin: "operator", text: "Oi! Aqui é o time comercial." },
    });
    expect(harness.sendText.calls).toEqual([
      { to: OPEN_PHONE, body: "Oi! Aqui é o time comercial." },
    ]);
    expect(auditRows()).toEqual([{ action: "send-message", lead_phone: OPEN_PHONE }]);

    const detail = await harness.app.inject({
      method: "GET",
      url: `/admin/api/conversations/${OPEN_PHONE}`,
      headers: { cookie },
    });
    const turns = detail.json().turns as Array<{ origin?: string; text: string }>;
    expect(turns.at(-1)).toMatchObject({ origin: "operator", text: "Oi! Aqui é o time comercial." });
  });

  it("janela fechada → 409 com o motivo, sem enviar", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: `/admin/api/conversations/${CLOSED_PHONE}/messages`,
      headers: { cookie },
      payload: { text: "oi" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "session_window_closed" });
    expect(res.json().reason).toEqual(expect.any(String));
    expect(harness.sendText.calls).toHaveLength(0);
    expect(auditRows()).toHaveLength(0);
  });

  it("gateway recusa por re-engagement → 409", async () => {
    harness.sendText.failWith(new WhatsAppApiError("Re-engagement message", { code: "131047" }));

    const res = await harness.app.inject({
      method: "POST",
      url: `/admin/api/conversations/${OPEN_PHONE}/messages`,
      headers: { cookie },
      payload: { text: "oi" },
    });

    expect(res.statusCode).toBe(409);
    expect(auditRows()).toHaveLength(0);
  });

  it("texto vazio → 422, sem enviar", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: `/admin/api/conversations/${OPEN_PHONE}/messages`,
      headers: { cookie },
      payload: { text: "   " },
    });

    expect(res.statusCode).toBe(422);
    expect(harness.sendText.calls).toHaveLength(0);
  });

  it("corpo sem `text` → 422", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: `/admin/api/conversations/${OPEN_PHONE}/messages`,
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(422);
  });

  it("sem sessão → 401", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: `/admin/api/conversations/${OPEN_PHONE}/messages`,
      payload: { text: "oi" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("telefone inexistente → 404", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/admin/api/conversations/+5511999999999/messages",
      headers: { cookie },
      payload: { text: "oi" },
    });
    expect(res.statusCode).toBe(404);
  });
});
