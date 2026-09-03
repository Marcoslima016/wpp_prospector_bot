import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { SESSION_COOKIE_NAME } from "./session-guard.ts";
import { constantTimeEquals, issue } from "./session-token.ts";

export interface AdminSessionRoutesDeps {
  accessSecret: string;
  sessionSecret: string;
  sessionTtlMs: number;
  /** `Path` do cookie — o prefixo em que o plugin `/admin` está montado. */
  cookiePath: string;
  clock?: () => Date;
}

const loginBodySchema = z.object({ secret: z.string().min(1) });

/**
 * `POST /api/session` — troca o segredo compartilhado por um cookie de sessão
 * assinado. `DELETE /api/session` — expira o cookie (logout). Montado sob o
 * prefixo `/admin`, então os caminhos efetivos são `/admin/api/session`.
 */
export const registerAdminSessionRoutes: FastifyPluginAsync<AdminSessionRoutesDeps> = async (
  app,
  deps,
) => {
  const clock = deps.clock ?? (() => new Date());
  const cookieOptions = {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: true,
    path: deps.cookiePath,
  };

  app.post("/api/session", async (request, reply) => {
    const parsed = loginBodySchema.safeParse(request.body);
    if (!parsed.success || !constantTimeEquals(parsed.data.secret, deps.accessSecret)) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const token = issue(clock(), deps.sessionTtlMs, deps.sessionSecret);
    reply.setCookie(SESSION_COOKIE_NAME, token, cookieOptions);
    return reply.code(200).send({ ok: true });
  });

  app.delete("/api/session", async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE_NAME, cookieOptions);
    return reply.code(204).send();
  });
};
