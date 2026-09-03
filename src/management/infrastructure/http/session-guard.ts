import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { verify } from "./session-token.ts";

export const SESSION_COOKIE_NAME = "admin_session";

function unauthorized(reply: FastifyReply): FastifyReply {
  return reply.code(401).send({ error: "unauthorized" });
}

function pathOf(request: FastifyRequest): string {
  const url = request.url;
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

/**
 * `preHandler` que exige um cookie de sessão válido para todo `.../api/...`,
 * menos `POST .../api/session` (login). Caminhos fora de `/api/` (estáticos da
 * SPA) passam sem sessão. Qualquer resultado diferente de `ok` → 401 com corpo
 * neutro, sem revelar dados de gestão.
 */
export function createAdminSessionGuard(deps: {
  sessionSecret: string;
  clock?: () => Date;
}): preHandlerAsyncHookHandler {
  const clock = deps.clock ?? (() => new Date());

  return async function adminSessionGuard(request, reply) {
    const path = pathOf(request);

    // Só a API é protegida; os estáticos da interface passam.
    if (!/\/api(\/|$)/.test(path)) return;

    // Login é o único endpoint de API acessível sem sessão.
    if (request.method === "POST" && /\/api\/session\/?$/.test(path)) return;

    const token = request.cookies?.[SESSION_COOKIE_NAME];
    if (token === undefined || token === "") {
      return unauthorized(reply);
    }

    if (verify(token, clock(), deps.sessionSecret).status !== "ok") {
      return unauthorized(reply);
    }
  };
}
