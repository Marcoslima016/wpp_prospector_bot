import { existsSync } from "node:fs";
import { resolve } from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import type { Logger } from "../../application/ports/logger.port.ts";

export interface AdminStaticDeps {
  /** Diretório do build da SPA, relativo ao diretório do processo. */
  webDistDir: string;
  logger: Logger;
}

/**
 * Serve os estáticos da interface de gestão sob o prefixo do plugin `/admin`
 * quando o build existe, com fallback SPA (`index.html`) para rotas de
 * navegação. Sem o diretório de build, não registra nada e a API `/admin/api/*`
 * segue funcionando. Deve ser chamada no escopo do plugin `/admin` (define o
 * `notFoundHandler` daquele contexto).
 */
export async function applyAdminStatic(app: FastifyInstance, deps: AdminStaticDeps): Promise<void> {
  const root = resolve(deps.webDistDir);

  if (!existsSync(root)) {
    deps.logger.info("Build da interface de gestão ausente — /admin serve apenas a API", { root });
    return;
  }

  await app.register(fastifyStatic, { root, prefix: "/", wildcard: false });

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split("?")[0] ?? "";
    // A API responde o próprio 404; só rotas de navegação caem no index.html.
    if (request.method !== "GET" || /\/api(\/|$)/.test(path)) {
      return reply.code(404).send({ error: "not_found" });
    }
    return reply.sendFile("index.html");
  });
}
