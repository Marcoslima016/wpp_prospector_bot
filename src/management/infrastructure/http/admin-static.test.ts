import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAdminTestApp, type AdminTestApp } from "../../test-support/admin-test-app.ts";

let harness: AdminTestApp;

afterEach(async () => {
  await harness.close();
});

describe("estáticos da SPA sob /admin", () => {
  it("com build presente serve index.html em / e nas rotas de navegação", async () => {
    const dist = await mkdtemp(join(tmpdir(), "admin-dist-"));
    await writeFile(join(dist, "index.html"), "<!doctype html><title>admin</title>", "utf8");
    await writeFile(join(dist, "app.js"), "console.log('ok')", "utf8");

    harness = await buildAdminTestApp({ webDistDir: dist });

    const root = await harness.app.inject({ method: "GET", url: "/admin/" });
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain("<title>admin</title>");

    const asset = await harness.app.inject({ method: "GET", url: "/admin/app.js" });
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toContain("console.log");

    const navigation = await harness.app.inject({ method: "GET", url: "/admin/conversations/123" });
    expect(navigation.statusCode).toBe(200);
    expect(navigation.body).toContain("<title>admin</title>");
  });

  it("sem build o boot não falha e a API segue respondendo", async () => {
    harness = await buildAdminTestApp({ webDistDir: join(tmpdir(), "dist-inexistente-xyz") });
    const cookie = await harness.login();

    const res = await harness.app.inject({
      method: "GET",
      url: "/admin/api/stats/overview",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
  });
});
