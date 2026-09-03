import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildConversation, type ConversationSpec } from "../../test-support/conversation-fixtures.ts";
import { buildAdminTestApp, type AdminTestApp } from "../../test-support/admin-test-app.ts";

const SPECS: ConversationSpec[] = [
  { leadPhone: "+5511900000001", at: new Date("2026-09-01T10:00:00.000Z"), intent: "interested" },
  {
    leadPhone: "+5511900000002",
    at: new Date("2026-09-03T10:00:00.000Z"),
    intent: "needs_more_info",
  },
  {
    leadPhone: "+5511955555555",
    at: new Date("2026-09-02T10:00:00.000Z"),
    intent: "interested",
    handoff: true,
    quotedPlan: "essencial",
    abandonedInbound: true,
  },
];

let harness: AdminTestApp;
let cookie: string;

beforeEach(async () => {
  harness = await buildAdminTestApp({ conversations: SPECS.map(buildConversation) });
  cookie = await harness.login();
});

afterEach(async () => {
  await harness.close();
});

function get(url: string, withCookie = true) {
  return harness.app.inject({
    method: "GET",
    url,
    headers: withCookie ? { cookie } : {},
  });
}

describe("GET /admin/api/conversations", () => {
  it("sem sessão → 401", async () => {
    expect((await get("/admin/api/conversations", false)).statusCode).toBe(401);
  });

  it("lista default ordenada por última atividade + paginação", async () => {
    const res = await get("/admin/api/conversations");
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.items.map((i: { leadPhone: string }) => i.leadPhone)).toEqual([
      "+5511900000002",
      "+5511955555555",
      "+5511900000001",
    ]);
    expect(body.pageSize).toBe(25);
    expect(body.nextCursor).toBeNull();
  });

  it("pagina com limit + cursor", async () => {
    const first = (await get("/admin/api/conversations?limit=2")).json();
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = (
      await get(`/admin/api/conversations?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`)
    ).json();
    expect(second.items.map((i: { leadPhone: string }) => i.leadPhone)).toEqual(["+5511900000001"]);
    expect(second.nextCursor).toBeNull();
  });

  it("filtra por estado", async () => {
    const body = (await get("/admin/api/conversations?state=awaitingHuman")).json();
    expect(body.items.map((i: { leadPhone: string }) => i.leadPhone)).toEqual(["+5511955555555"]);
  });

  it("combina filtros (intent + faixa de data)", async () => {
    const body = (
      await get(
        "/admin/api/conversations?leadIntent=interested&activityFrom=2026-09-01T12:00:00.000Z",
      )
    ).json();
    expect(body.items.map((i: { leadPhone: string }) => i.leadPhone)).toEqual(["+5511955555555"]);
  });

  it("busca por trecho do telefone", async () => {
    const body = (await get("/admin/api/conversations?phone=95555")).json();
    expect(body.items.map((i: { leadPhone: string }) => i.leadPhone)).toEqual(["+5511955555555"]);
  });

  it("nenhum match → página vazia 200", async () => {
    const res = await get("/admin/api/conversations?state=ended");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], pageSize: 25, nextCursor: null });
  });

  it("query inválida → 400", async () => {
    expect((await get("/admin/api/conversations?state=bogus")).statusCode).toBe(400);
    expect((await get("/admin/api/conversations?limit=0")).statusCode).toBe(400);
  });
});

describe("GET /admin/api/conversations/:leadPhone", () => {
  it("sem sessão → 401", async () => {
    expect((await get("/admin/api/conversations/+5511900000001", false)).statusCode).toBe(401);
  });

  it("detalhe de conversa existente com todos os campos", async () => {
    const res = await get("/admin/api/conversations/+5511955555555");
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body).toMatchObject({
      leadPhone: "+5511955555555",
      state: "awaitingHuman",
      leadIntent: "interested",
      quotedPlan: "essencial",
      hasPendingInbound: false,
      hasAbandonedInbound: true,
    });
    expect(Array.isArray(body.turns)).toBe(true);
    expect(body.turns.length).toBe(body.turnCount);
  });

  it("detalhe reflete o arquivo mesmo com o índice desatualizado", async () => {
    // Grava direto no repositório real (sem passar pela projeção): índice fica velho.
    harness.inner.seed(
      buildConversation({
        leadPhone: "+5511900000001",
        at: new Date("2026-09-05T10:00:00.000Z"),
        intent: "opt_out",
        end: true,
      }),
    );

    const detail = (await get("/admin/api/conversations/+5511900000001")).json();
    expect(detail.state).toBe("ended");
    expect(detail.leadIntent).toBe("opt_out");

    // A listagem (projeção) ainda mostra o estado antigo.
    const listed = (await get("/admin/api/conversations?phone=900000001")).json();
    expect(listed.items[0].state).toBe("active");
  });

  it("telefone sem conversa → 404", async () => {
    expect((await get("/admin/api/conversations/+5519999999999")).statusCode).toBe(404);
  });
});
