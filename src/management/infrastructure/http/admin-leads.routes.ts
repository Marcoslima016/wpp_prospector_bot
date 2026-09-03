import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import type { BulkProspectLeadsUseCase } from "../../application/bulk-prospect-leads.use-case.ts";
import {
  FirstContactTemplateNotConfiguredError,
  InvalidLeadPhoneError,
  LeadBatchTooLargeError,
  LeadNotFoundError,
  ProspectingGatewayError,
} from "../../application/errors.ts";
import type { ImportLeadsUseCase } from "../../application/import-leads.use-case.ts";
import type { ProspectLeadUseCase } from "../../application/prospect-lead.use-case.ts";
import type { RegisterLeadUseCase } from "../../application/register-lead.use-case.ts";
import type { ResetLeadProspectingUseCase } from "../../application/reset-lead-prospecting.use-case.ts";
import type { LeadRepositoryPort } from "../../application/ports/lead-repository.port.ts";
import {
  toBulkProspectResult,
  toImportLeadsResult,
  toLeadListPage,
  toLeadResource,
} from "../../interface/lead.mapper.ts";
import {
  bulkProspectInputSchema,
  bulkProspectResultSchema,
  importLeadsInputSchema,
  importLeadsResultSchema,
  leadListPageSchema,
  prospectLeadResultSchema,
  registerLeadResultSchema,
  resetLeadResultSchema,
} from "../../interface/dto/lead.dto.ts";
import { leadListQuerySchema } from "../../interface/dto/query.ts";
import { replyWithContract } from "./reply-with-contract.ts";

export interface AdminLeadsRoutesDeps {
  registerLead: RegisterLeadUseCase;
  prospectLead: ProspectLeadUseCase;
  importLeads: ImportLeadsUseCase;
  bulkProspect: BulkProspectLeadsUseCase;
  resetLead: ResetLeadProspectingUseCase;
  leads: LeadRepositoryPort;
}

const registerLeadBodySchema = z.object({
  phone: z.string(),
  displayName: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
  notes: z.string().min(1).optional(),
  company: z.string().min(1).optional(),
  segment: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
});

const prospectBodySchema = z.object({
  parameters: z.union([z.array(z.string()), z.record(z.string(), z.string())]).optional(),
  force: z.boolean().optional(),
});

/** Traduz os erros de aplicação da prospecção para o HTTP. */
function replyWithLeadError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof InvalidLeadPhoneError) {
    return reply.code(422).send({ error: "invalid_phone", reason: error.message });
  }
  if (error instanceof LeadBatchTooLargeError) {
    return reply.code(422).send({ error: "batch_too_large", reason: error.message });
  }
  if (error instanceof LeadNotFoundError) {
    return reply.code(404).send({ error: "lead_not_found" });
  }
  if (error instanceof FirstContactTemplateNotConfiguredError) {
    return reply.code(503).send({ error: "first_contact_template_not_configured" });
  }
  if (error instanceof ProspectingGatewayError) {
    return reply.code(502).send({ error: "prospecting_gateway_error", reason: error.reason });
  }
  throw error;
}

/**
 * Rotas de leads sob `/admin` (guarda de sessão herdada de `register-admin-routes`):
 *  - `POST /api/leads` — cadastro individual;
 *  - `POST /api/leads/import` — importação em lote (sem disparo);
 *  - `POST /api/leads/prospect` — disparo de prospecção em lote (continue-on-error, sempre 200);
 *  - `POST /api/leads/:leadPhone/prospect` — disparo individual;
 *  - `POST /api/leads/:leadPhone/reset` — reset da prospecção de um lead;
 *  - `GET /api/leads` — listagem paginada e filtrável.
 */
export const registerAdminLeadsRoutes: FastifyPluginAsync<AdminLeadsRoutesDeps> = async (
  app,
  deps,
) => {
  app.get("/api/leads", async (request, reply) => {
    const parsed = leadListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", issues: parsed.error.issues });
    }

    const page = await deps.leads.query({
      state: parsed.data.state,
      phoneContains: parsed.data.phone,
      segment: parsed.data.segment,
      limit: parsed.data.limit,
      cursor: parsed.data.cursor,
    });
    return replyWithContract(reply, leadListPageSchema, toLeadListPage(page, parsed.data.limit));
  });

  app.post("/api/leads", async (request, reply) => {
    const parsed = registerLeadBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: "invalid_body", issues: parsed.error.issues });
    }

    try {
      const lead = await deps.registerLead.register(parsed.data);
      return replyWithContract(reply, registerLeadResultSchema, toLeadResource(lead));
    } catch (error) {
      return replyWithLeadError(reply, error);
    }
  });

  app.post("/api/leads/import", async (request, reply) => {
    const parsed = importLeadsInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: "invalid_body", issues: parsed.error.issues });
    }

    try {
      const result = await deps.importLeads.import({ leads: parsed.data.leads });
      return replyWithContract(reply, importLeadsResultSchema, toImportLeadsResult(result));
    } catch (error) {
      return replyWithLeadError(reply, error);
    }
  });

  app.post("/api/leads/prospect", async (request, reply) => {
    const parsed = bulkProspectInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: "invalid_body", issues: parsed.error.issues });
    }

    try {
      const result = await deps.bulkProspect.prospect({
        phones: parsed.data.phones,
        force: parsed.data.force,
      });
      return replyWithContract(reply, bulkProspectResultSchema, toBulkProspectResult(result));
    } catch (error) {
      return replyWithLeadError(reply, error);
    }
  });

  app.post<{ Params: { leadPhone: string } }>(
    "/api/leads/:leadPhone/prospect",
    async (request, reply) => {
      const parsed = prospectBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(422).send({ error: "invalid_body", issues: parsed.error.issues });
      }

      try {
        const outcome = await deps.prospectLead.prospect(request.params.leadPhone, {
          parameters: parsed.data.parameters,
          force: parsed.data.force,
        });
        return replyWithContract(reply, prospectLeadResultSchema, {
          wamid: outcome.wamid,
          alreadyProspected: outcome.alreadyProspected,
          lead: toLeadResource(outcome.lead),
        });
      } catch (error) {
        return replyWithLeadError(reply, error);
      }
    },
  );

  app.post<{ Params: { leadPhone: string } }>(
    "/api/leads/:leadPhone/reset",
    async (request, reply) => {
      try {
        const lead = await deps.resetLead.reset(request.params.leadPhone);
        return replyWithContract(reply, resetLeadResultSchema, toLeadResource(lead));
      } catch (error) {
        return replyWithLeadError(reply, error);
      }
    },
  );
};
