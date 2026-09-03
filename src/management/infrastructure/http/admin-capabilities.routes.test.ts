import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAdminTestApp, type AdminTestApp } from "../../test-support/admin-test-app.ts";

let harness: AdminTestApp;
let cookie: string;

beforeEach(async () => {
  harness = await buildAdminTestApp();
  cookie = await harness.login();
});

afterEach(async () => {
  await harness.close();
});

describe("GET /admin/api/capabilities", () => {
  it("declara as famílias de ação montadas", async () => {
    const res = await harness.app.inject({
      method: "GET",
      url: "/admin/api/capabilities",
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ conversationActions: true, prospecting: true });
  });

  it("sem sessão → 401", async () => {
    const res = await harness.app.inject({ method: "GET", url: "/admin/api/capabilities" });
    expect(res.statusCode).toBe(401);
  });
});
