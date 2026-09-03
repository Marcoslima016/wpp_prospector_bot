import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAdminTestApp, type AdminTestApp } from "./test-support/admin-test-app.ts";

let harness: AdminTestApp;
let cookie: string;

const A = "+5516990000001"; // pending → disparado
const B = "+5516990000002"; // pending → disparado, depois resetado
const C = "+5516990000003"; // pending → nunca disparado
const MISSING = "+5516990009999"; // sem lead cadastrado

beforeEach(async () => {
  harness = await buildAdminTestApp();
  cookie = await harness.login();
});

afterEach(async () => {
  await harness.close();
});

async function list(query = ""): Promise<Array<{ phone: string; prospectingState: string; segment: string | null }>> {
  const res = await harness.app.inject({
    method: "GET",
    url: `/admin/api/leads${query}`,
    headers: { cookie },
  });
  expect(res.statusCode).toBe(200);
  return res.json().items;
}

async function turnCount(phone: string): Promise<number> {
  const res = await harness.app.inject({
    method: "GET",
    url: `/admin/api/conversations/${phone}`,
    headers: { cookie },
  });
  return res.statusCode === 200 ? (res.json().turns as unknown[]).length : -1;
}

describe("importação + disparo em lote — fluxo ponta a ponta", () => {
  it("importa sem disparar, lista, dispara em lote, semeia só os enviados, reseta e redispara", async () => {
    // 1. Importa um lote — nenhum disparo.
    const imported = await harness.app.inject({
      method: "POST",
      url: "/admin/api/leads/import",
      headers: { cookie },
      payload: {
        leads: [
          { phone: "16990000001", segment: "obras", company: "A SA" },
          { phone: "16990000002", segment: "obras" },
          { phone: "16990000003", segment: "varejo" },
          { phone: "" }, // rejeitada
        ],
      },
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json()).toMatchObject({ imported: 3, updated: 0 });
    expect(imported.json().rejected).toHaveLength(1);
    expect(harness.sendTemplate.calls).toHaveLength(0);

    // 2. Lista via GET /api/leads — todos pending.
    const all = await list();
    expect(all.map((l) => l.phone).sort()).toEqual([A, B, C]);
    expect(all.every((l) => l.prospectingState === "pending")).toBe(true);

    const obras = await list("?segment=obras");
    expect(obras.map((l) => l.phone).sort()).toEqual([A, B]);

    // 3. Dispara em lote para a seleção pending A e B + um telefone sem lead.
    const bulk = await harness.app.inject({
      method: "POST",
      url: "/admin/api/leads/prospect",
      headers: { cookie },
      payload: { phones: [A, B, MISSING] },
    });
    expect(bulk.statusCode).toBe(200);
    const outcomes = Object.fromEntries(
      (bulk.json().results as Array<{ phone: string; outcome: string }>).map((r) => [r.phone, r.outcome]),
    );
    expect(outcomes).toEqual({ [A]: "sent", [B]: "sent", [MISSING]: "failed" });

    // 4/5. Conversa semeada só para os enviados; C (não disparado) sem conversa.
    expect(await turnCount(A)).toBe(1);
    expect(await turnCount(B)).toBe(1);
    expect(await turnCount(C)).toBe(-1);
    expect(harness.sendTemplate.calls).toHaveLength(2);

    // Redisparo sem force → skipped por lead.
    const again = await harness.app.inject({
      method: "POST",
      url: "/admin/api/leads/prospect",
      headers: { cookie },
      payload: { phones: [A, B] },
    });
    expect(
      (again.json().results as Array<{ outcome: string }>).every((r) => r.outcome === "skipped"),
    ).toBe(true);
    expect(harness.sendTemplate.calls).toHaveLength(2);

    // 6. Reseta B e redispara — acrescenta um novo turno à conversa existente.
    const reset = await harness.app.inject({
      method: "POST",
      url: `/admin/api/leads/${B}/reset`,
      headers: { cookie },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toMatchObject({ phone: B, prospectingState: "pending" });

    const afterReset = await list("?state=pending");
    expect(afterReset.map((l) => l.phone).sort()).toEqual([B, C]);

    const redispatch = await harness.app.inject({
      method: "POST",
      url: "/admin/api/leads/prospect",
      headers: { cookie },
      payload: { phones: [B] },
    });
    expect((redispatch.json().results as Array<{ outcome: string }>)[0]!.outcome).toBe("sent");
    expect(await turnCount(B)).toBe(2);
    expect(harness.sendTemplate.calls).toHaveLength(3);
  });
});
