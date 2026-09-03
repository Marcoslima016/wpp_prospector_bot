import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerAdminSessionRoutes } from "./admin-session.routes.ts";
import { createAdminSessionGuard } from "./session-guard.ts";

const ACCESS_SECRET = "shared-access-secret";
const SESSION_SECRET = "server-session-secret";
const TTL = 12 * 60 * 60 * 1000;

let now = new Date("2026-09-02T12:00:00.000Z");
let app: FastifyInstance;

beforeEach(async () => {
  now = new Date("2026-09-02T12:00:00.000Z");
  app = Fastify();
  await app.register(cookie);
  app.addHook("preHandler", createAdminSessionGuard({ sessionSecret: SESSION_SECRET, clock: () => now }));
  await app.register(registerAdminSessionRoutes, {
    accessSecret: ACCESS_SECRET,
    sessionSecret: SESSION_SECRET,
    sessionTtlMs: TTL,
    cookiePath: "/admin",
    clock: () => now,
  });
  app.get("/api/protected", async () => ({ ok: true }));
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

function sessionCookie(headers: Record<string, unknown>): string {
  const setCookie = headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie[0] : String(setCookie);
  return raw.split(";")[0] ?? "";
}

describe("rotas de sessão /admin + guarda", () => {
  it("login com o segredo correto responde 200 e define o cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/session",
      payload: { secret: ACCESS_SECRET },
    });

    expect(res.statusCode).toBe(200);
    const raw = String(res.headers["set-cookie"]);
    expect(raw).toContain("admin_session=");
    expect(raw).toContain("HttpOnly");
    expect(raw).toContain("SameSite=Strict");
    expect(raw).toContain("Secure");
    expect(raw).toContain("Path=/admin");
  });

  it("login com o segredo errado responde 401 e não define cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/session",
      payload: { secret: "wrong" },
    });

    expect(res.statusCode).toBe(401);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("endpoint protegido sem cookie → 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/protected" });
    expect(res.statusCode).toBe(401);
  });

  it("endpoint protegido com cookie inválido → 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/protected",
      cookies: { admin_session: "garbage.value" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("endpoint protegido com cookie de sessão válido → 200", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/session",
      payload: { secret: ACCESS_SECRET },
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/protected",
      headers: { cookie: sessionCookie(login.headers) },
    });
    expect(res.statusCode).toBe(200);
  });

  it("cookie expirado → 401", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/session",
      payload: { secret: ACCESS_SECRET },
    });
    const cookieHeader = sessionCookie(login.headers);

    now = new Date(now.getTime() + TTL + 1);

    const res = await app.inject({
      method: "GET",
      url: "/api/protected",
      headers: { cookie: cookieHeader },
    });
    expect(res.statusCode).toBe(401);
  });

  it("logout expira o cookie e o acesso volta a 401", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/session",
      payload: { secret: ACCESS_SECRET },
    });
    const cookieHeader = sessionCookie(login.headers);

    const logout = await app.inject({
      method: "DELETE",
      url: "/api/session",
      headers: { cookie: cookieHeader },
    });
    expect(logout.statusCode).toBe(204);
    const cleared = String(logout.headers["set-cookie"]);
    expect(cleared).toMatch(/admin_session=;|admin_session=;\s/);

    // Cookie limpo (sem valor) não autentica.
    const res = await app.inject({
      method: "GET",
      url: "/api/protected",
      headers: { cookie: "admin_session=" },
    });
    expect(res.statusCode).toBe(401);
  });
});
