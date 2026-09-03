import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WhatsAppApiError } from "../../../whatsapp-connectivity/application/errors.ts";
import { buildAdminTestApp, type AdminTestApp } from "../../test-support/admin-test-app.ts";

const PHONE = "+5511900000001";

let harness: AdminTestApp;
let cookie: string;

beforeEach(async () => {
  harness = await buildAdminTestApp();
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

async function register(phone: string, body: Record<string, unknown> = {}): Promise<number> {
  const res = await harness.app.inject({
    method: "POST",
    url: "/admin/api/leads",
    headers: { cookie },
    payload: { phone, ...body },
  });
  return res.statusCode;
}

async function prospect(
  phone: string,
  payload: Record<string, unknown> = {},
): Promise<ReturnType<AdminTestApp["app"]["inject"]>> {
  return harness.app.inject({
    method: "POST",
    url: `/admin/api/leads/${phone}/prospect`,
    headers: { cookie },
    payload,
  });
}

describe("POST /admin/api/leads", () => {
  it("cadastra um lead novo em estado pending", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/admin/api/leads",
      headers: { cookie },
      payload: { phone: PHONE, displayName: "Ana", source: "ads" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      phone: PHONE,
      displayName: "Ana",
      source: "ads",
      prospectingState: "pending",
    });
  });

  it("re-cadastro do mesmo telefone não duplica", async () => {
    await register(PHONE, { displayName: "Ana" });
    await register(PHONE, { notes: "ligar à tarde" });

    const count = harness.db.prepare("SELECT COUNT(*) AS n FROM leads").get() as { n: number };
    expect(count.n).toBe(1);
  });

  it("telefone fora de E.164 → 422", async () => {
    expect(await register("11900000001")).toBe(422);
  });

  it("sem sessão → 401", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/admin/api/leads",
      payload: { phone: PHONE },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /admin/api/leads/:leadPhone/prospect", () => {
  it("dispara o primeiro contato: envia o template, cria a conversa com turno prospecting e marca sent", async () => {
    await register(PHONE);

    const res = await prospect(PHONE, { parameters: ["Ana"] });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      wamid: "wamid.tmpl.1",
      alreadyProspected: false,
      lead: { phone: PHONE, prospectingState: "sent" },
    });
    expect(harness.sendTemplate.calls).toEqual([
      {
        to: PHONE,
        templateName: "prospeccao_primeiro_contato",
        languageCode: "pt_BR",
        parameters: ["Ana"],
      },
    ]);
    expect(auditRows()).toEqual([{ action: "prospect", lead_phone: PHONE }]);

    const detail = await harness.app.inject({
      method: "GET",
      url: `/admin/api/conversations/${PHONE}`,
      headers: { cookie },
    });
    expect(detail.statusCode).toBe(200);
    const turns = detail.json().turns as Array<{ direction: string; origin?: string; kind?: string }>;
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ direction: "outbound", origin: "operator", kind: "prospecting" });
  });

  it("lead não cadastrado → 404", async () => {
    const res = await prospect(PHONE);
    expect(res.statusCode).toBe(404);
    expect(harness.sendTemplate.calls).toHaveLength(0);
  });

  it("sem sessão → 401", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: `/admin/api/leads/${PHONE}/prospect`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("gateway rejeita → 502 e o lead fica em failed", async () => {
    await register(PHONE);
    harness.sendTemplate.failWith(new WhatsAppApiError("Template não aprovado", { code: "132001" }));

    const res = await prospect(PHONE);

    expect(res.statusCode).toBe(502);
    expect((await harness.leads.findByPhone(PHONE))!.prospectingState).toBe("failed");
    expect(auditRows()).toHaveLength(0);
  });

  it("redisparo sem force → alreadyProspected: true e nenhum turno novo", async () => {
    await register(PHONE);
    await prospect(PHONE);

    const res = await prospect(PHONE);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ wamid: null, alreadyProspected: true });
    expect(harness.sendTemplate.calls).toHaveLength(1);

    const detail = await harness.app.inject({
      method: "GET",
      url: `/admin/api/conversations/${PHONE}`,
      headers: { cookie },
    });
    expect(detail.json().turns).toHaveLength(1);
  });
});

describe("POST /admin/api/leads/:leadPhone/prospect — template não configurado", () => {
  let localHarness: AdminTestApp;
  let localCookie: string;

  beforeEach(async () => {
    localHarness = await buildAdminTestApp({
      firstContactTemplate: { name: "  ", lang: "pt_BR", paramKeys: [] },
    });
    localCookie = await localHarness.login();
  });

  afterEach(async () => {
    await localHarness.close();
  });

  it("→ 503 sem enviar nada", async () => {
    await localHarness.app.inject({
      method: "POST",
      url: "/admin/api/leads",
      headers: { cookie: localCookie },
      payload: { phone: PHONE },
    });

    const res = await localHarness.app.inject({
      method: "POST",
      url: `/admin/api/leads/${PHONE}/prospect`,
      headers: { cookie: localCookie },
      payload: {},
    });

    expect(res.statusCode).toBe(503);
    expect(localHarness.sendTemplate.calls).toHaveLength(0);
  });
});
