import type { FastifyReply } from "fastify";
import { z } from "zod";

/**
 * Divergência entre o corpo produzido por um endpoint de gestão e o contrato
 * declarado. Lançada apenas com a verificação ligada (fora de produção) — em um
 * handler Fastify vira 500, tornando a divergência visível em vez de silenciosa.
 */
export class ContractViolationError extends Error {
  constructor(
    message: string,
    readonly issues: z.ZodError["issues"],
  ) {
    super(message);
    this.name = "ContractViolationError";
  }
}

/**
 * A verificação de contrato roda fora de produção (desenvolvimento, teste ou
 * `NODE_ENV` não definido). Em produção o payload passa direto, sem custo.
 */
export function isContractCheckEnabled(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv !== "production";
}

/**
 * Valida `payload` contra `schema` quando a verificação está ligada e devolve o
 * dado (parseado). Com a verificação desligada, devolve `payload` como veio.
 * Lança `ContractViolationError` na divergência.
 */
export function checkContract<T>(
  schema: z.ZodType<T>,
  payload: unknown,
  nodeEnv?: string | undefined,
): T {
  if (!isContractCheckEnabled(nodeEnv)) {
    return payload as T;
  }

  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new ContractViolationError(
      "Resposta de gestão não bate com o contrato declarado",
      result.error.issues,
    );
  }
  return result.data;
}

/** Responde `payload` como JSON após conferi-lo contra `schema`. */
export function replyWithContract<T>(
  reply: FastifyReply,
  schema: z.ZodType<T>,
  payload: T,
): FastifyReply {
  const checked = checkContract(schema, payload);
  return reply.send(checked);
}
