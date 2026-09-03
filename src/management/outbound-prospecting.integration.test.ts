import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WhatsAppApiError } from "../whatsapp-connectivity/application/errors.ts";
import { buildAdminTestApp, type AdminTestApp } from "./test-support/admin-test-app.ts";

const PHONE = "+5511911112222";

let harness: AdminTestApp;
let cookie: string;

beforeEach(async () => {
  harness = await buildAdminTestApp();
  cookie = await harness.login();
});

afterEach(async () => {
  await harness.close();
});

function auditActions(): string[] {
  return (
    harness.db.prepare("SELECT action FROM admin_action_events ORDER BY id").all() as Array<{
      action: string;
    }>
  ).map((row) => row.action);
}

async function conversationDetail(phone: string): Promise<{
  statusCode: number;
  turns: Array<{ direction: string; origin?: string; kind?: string }>;
}> {
  const res = await harness.app.inject({
    method: "GET",
    url: `/admin/api/conversations/${phone}`,
    headers: { cookie },
  });
  return {
    statusCode: res.statusCode,
    turns: res.statusCode === 200 ? res.json().turns : [],
  };
}

describe("prospecção outbound — fluxo ponta a ponta", () => {
  it("cadastro → disparo → semeadura da conversa → primeiro inbound leva a replied", async () => {
    const register = await harness.app.inject({
      method: "POST",
      url: "/admin/api/leads",
      headers: { cookie },
      payload: { phone: PHONE, displayName: "Ana", source: "feira" },
    });
    expect(register.statusCode).toBe(200);
    expect(register.json()).toMatchObject({ prospectingState: "pending" });

    const prospect = await harness.app.inject({
      method: "POST",
      url: `/admin/api/leads/${PHONE}/prospect`,
      headers: { cookie },
      payload: { parameters: { "1": "Ana" } },
    });
    expect(prospect.statusCode).toBe(200);
    expect(prospect.json()).toMatchObject({
      wamid: "wamid.tmpl.1",
      alreadyProspected: false,
      lead: { prospectingState: "sent" },
    });

    const detail = await conversationDetail(PHONE);
    expect(detail.turns).toHaveLength(1);
    expect(detail.turns[0]).toMatchObject({
      direction: "outbound",
      origin: "operator",
      kind: "prospecting",
    });
    expect(auditActions()).toEqual(["prospect"]);

    // O lead responde: a próxima gravação da conversa (com um inbound) promove
    // o estado de prospecção para `replied`.
    const conversation = await harness.repository.load(PHONE);
    conversation!.recordInboundTurn({
      text: "oi, tenho interesse",
      timestamp: harness.now.value,
      messageId: `${PHONE}-in-1`,
    });
    await harness.repository.save(conversation!);

    expect((await harness.leads.findByPhone(PHONE))!.prospectingState).toBe("replied");
  });

  it("sem sessão: cadastro e disparo respondem 401", async () => {
    const register = await harness.app.inject({
      method: "POST",
      url: "/admin/api/leads",
      payload: { phone: PHONE },
    });
    const prospect = await harness.app.inject({
      method: "POST",
      url: `/admin/api/leads/${PHONE}/prospect`,
      payload: {},
    });
    expect(register.statusCode).toBe(401);
    expect(prospect.statusCode).toBe(401);
  });

  it("gateway rejeita o template → 502, lead em failed e nenhuma conversa semeada", async () => {
    await harness.app.inject({
      method: "POST",
      url: "/admin/api/leads",
      headers: { cookie },
      payload: { phone: PHONE },
    });
    harness.sendTemplate.failWith(new WhatsAppApiError("Template pausado", { code: "132015" }));

    const res = await harness.app.inject({
      method: "POST",
      url: `/admin/api/leads/${PHONE}/prospect`,
      headers: { cookie },
      payload: {},
    });

    expect(res.statusCode).toBe(502);
    expect((await harness.leads.findByPhone(PHONE))!.prospectingState).toBe("failed");
    expect((await conversationDetail(PHONE)).statusCode).toBe(404);
    expect(auditActions()).toEqual([]);
  });

  it("redisparo sem force é no-op; com force acrescenta um novo turno", async () => {
    await harness.app.inject({
      method: "POST",
      url: "/admin/api/leads",
      headers: { cookie },
      payload: { phone: PHONE },
    });
    await harness.app.inject({
      method: "POST",
      url: `/admin/api/leads/${PHONE}/prospect`,
      headers: { cookie },
      payload: {},
    });

    const again = await harness.app.inject({
      method: "POST",
      url: `/admin/api/leads/${PHONE}/prospect`,
      headers: { cookie },
      payload: {},
    });
    expect(again.json()).toMatchObject({ wamid: null, alreadyProspected: true });
    expect((await conversationDetail(PHONE)).turns).toHaveLength(1);

    const forced = await harness.app.inject({
      method: "POST",
      url: `/admin/api/leads/${PHONE}/prospect`,
      headers: { cookie },
      payload: { force: true },
    });
    expect(forced.statusCode).toBe(200);
    expect(forced.json()).toMatchObject({ alreadyProspected: false });

    const turns = (await conversationDetail(PHONE)).turns;
    expect(turns).toHaveLength(2);
    expect(turns.every((t) => t.kind === "prospecting")).toBe(true);
    expect(harness.sendTemplate.calls).toHaveLength(2);
  });

  it("disparo para telefone sem lead cadastrado → 404", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: `/admin/api/leads/${PHONE}/prospect`,
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("prospecção outbound — template não configurado", () => {
  let local: AdminTestApp;
  let localCookie: string;

  beforeEach(async () => {
    local = await buildAdminTestApp({
      firstContactTemplate: { name: "", lang: "pt_BR", paramKeys: [] },
    });
    localCookie = await local.login();
  });

  afterEach(async () => {
    await local.close();
  });

  it("disparo → 503 e nada é enviado", async () => {
    await local.app.inject({
      method: "POST",
      url: "/admin/api/leads",
      headers: { cookie: localCookie },
      payload: { phone: PHONE },
    });

    const res = await local.app.inject({
      method: "POST",
      url: `/admin/api/leads/${PHONE}/prospect`,
      headers: { cookie: localCookie },
      payload: {},
    });

    expect(res.statusCode).toBe(503);
    expect(local.sendTemplate.calls).toHaveLength(0);
    expect((await local.leads.findByPhone(PHONE))!.prospectingState).toBe("pending");
  });
});
