import cookie from "@fastify/cookie";
import type { FastifyPluginAsync } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import type { ConversationRepositoryPort } from "../../../conversation-engine/application/ports/conversation-repository.port.ts";
import type { LeadSerialQueue } from "../../../conversation-engine/infrastructure/inbound/lead-serial-queue.ts";
import type { SendOutboundMessageUseCase } from "../../../whatsapp-connectivity/application/use-cases/send-outbound-message.use-case.ts";
import type { SendTextMessageUseCase } from "../../../whatsapp-connectivity/application/use-cases/send-text-message.use-case.ts";
import { ConversationActionUseCase } from "../../application/conversation-action.use-case.ts";
import { ProspectLeadUseCase } from "../../application/prospect-lead.use-case.ts";
import { RegisterLeadUseCase } from "../../application/register-lead.use-case.ts";
import type { AdminActionAuditPort } from "../../application/ports/admin-action-audit.port.ts";
import type { LeadRepositoryPort } from "../../application/ports/lead-repository.port.ts";
import { ConsumptionStatsService } from "../../application/consumption-stats.service.ts";
import type { Logger } from "../../application/ports/logger.port.ts";
import type { ResolvedAdminConfig } from "../config/env.ts";
import { ConversationIndexQueries } from "../persistence/conversation-index-queries.ts";
import { registerAdminConversationActionsRoutes } from "./admin-conversation-actions.routes.ts";
import { registerAdminConversationsRoutes } from "./admin-conversations.routes.ts";
import { registerAdminLeadsRoutes } from "./admin-leads.routes.ts";
import { registerAdminSessionRoutes } from "./admin-session.routes.ts";
import { registerAdminStatsRoutes } from "./admin-stats.routes.ts";
import { applyAdminStatic } from "./admin-static.ts";
import { createAdminSessionGuard } from "./session-guard.ts";

export interface AdminRoutesDeps {
  config: ResolvedAdminConfig;
  db: DatabaseSync;
  /** Repositório de conversas (fonte da verdade) — usado no detalhe e nas ações. */
  repository: ConversationRepositoryPort;
  /** Envio de texto de sessão — delegado pelas ações de operação (mensagem avulsa). */
  sendText: SendTextMessageUseCase;
  /** Envio de template — delegado pelo disparo de prospecção (primeiro contato). */
  sendTemplate: SendOutboundMessageUseCase;
  /** Repositório dos leads de prospecção. */
  leads: LeadRepositoryPort;
  /** Fila serial por lead — compartilhada com o processamento de inbound. */
  queue: LeadSerialQueue;
  /** Trilha de auditoria append-only das ações de operação. */
  audit: AdminActionAuditPort;
  logger: Logger;
  clock?: () => Date;
}

/**
 * Plugin `/admin`: cookie + guarda de sessão + rotas de sessão/conversas/stats
 * + ações de operação sobre conversas + estáticos da SPA. Montado ao lado do
 * plugin de webhook no mesmo processo, isolado dele (encapsulamento do Fastify).
 * Registrado com `prefix: "/admin"`.
 */
export const registerAdminRoutes: FastifyPluginAsync<AdminRoutesDeps> = async (app, deps) => {
  const clock = deps.clock ?? (() => new Date());

  await app.register(cookie);
  app.addHook(
    "preHandler",
    createAdminSessionGuard({ sessionSecret: deps.config.sessionSecret, clock }),
  );

  const queries = new ConversationIndexQueries(deps.db);
  const consumptionStats = new ConsumptionStatsService(deps.db);
  const conversationActions = new ConversationActionUseCase({
    repository: deps.repository,
    queue: deps.queue,
    sendText: deps.sendText,
    audit: deps.audit,
    logger: deps.logger,
    clock,
  });
  const registerLead = new RegisterLeadUseCase({ leads: deps.leads });
  const prospectLead = new ProspectLeadUseCase({
    leads: deps.leads,
    conversations: deps.repository,
    queue: deps.queue,
    sendTemplate: deps.sendTemplate,
    template: deps.config.firstContactTemplate,
    audit: deps.audit,
    logger: deps.logger,
    clock,
  });
  const cookiePath = app.prefix !== "" ? app.prefix : "/";

  await app.register(registerAdminSessionRoutes, {
    accessSecret: deps.config.accessSecret,
    sessionSecret: deps.config.sessionSecret,
    sessionTtlMs: deps.config.sessionTtlMs,
    cookiePath,
    clock,
  });
  await app.register(registerAdminConversationsRoutes, {
    queries,
    repository: deps.repository,
  });
  await app.register(registerAdminConversationActionsRoutes, { conversationActions });
  await app.register(registerAdminLeadsRoutes, { registerLead, prospectLead });
  await app.register(registerAdminStatsRoutes, { consumptionStats, queries });

  await applyAdminStatic(app, { webDistDir: deps.config.webDistDir, logger: deps.logger });
};
