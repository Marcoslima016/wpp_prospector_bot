import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import {
  FirstContactTemplateNotConfiguredError,
  InvalidLeadPhoneError,
  LeadNotFoundError,
  ProspectingGatewayError,
} from "../../application/errors.ts";
import type { ProspectLeadUseCase } from "../../application/prospect-lead.use-case.ts";
import type { RegisterLeadUseCase } from "../../application/register-lead.use-case.ts";
import { toLeadResource } from "../../interface/lead.mapper.ts";
import { prospectLeadResultSchema, registerLeadResultSchema } from "../../interface/dto/lead.dto.ts";
import { replyWithContract } from "./reply-with-contract.ts";

export interface AdminLeadsRoutesDeps {
  registerLead: RegisterLeadUseCase;
  prospectLead: ProspectLeadUseCase;
}

const registerLeadBodySchema = z.object({
  phone: z.string(),
  displayName: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
  notes: z.string().min(1).optional(),
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
 * `POST /api/leads` e `POST /api/leads/:leadPhone/prospect` — cadastro de lead e
 * disparo do primeiro contato de prospecção. Montadas sob o mesmo escopo coberto
 * pela guarda de sessão (`register-admin-routes`), então exigem sessão.
 */
export const registerAdminLeadsRoutes: FastifyPluginAsync<AdminLeadsRoutesDeps> = async (
  app,
  deps,
) => {
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
};
