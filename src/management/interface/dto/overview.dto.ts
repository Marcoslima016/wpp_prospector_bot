import { z } from "zod";
import { CONVERSATION_STATES } from "./common.ts";

/** Contadores do "agora" derivados da projeção de leitura. */
export const overviewSchema = z.object({
  /** Uma contagem por estado do ciclo de vida; sempre presente, zero quando vazio. */
  conversationsByState: z.object({
    active: z.number().int().nonnegative(),
    ended: z.number().int().nonnegative(),
    awaitingHuman: z.number().int().nonnegative(),
  }),
  totalLeads: z.number().int().nonnegative(),
  pendingInbound: z.number().int().nonnegative(),
});

export type Overview = z.infer<typeof overviewSchema>;

/** Base zerada — usada quando a projeção está vazia. */
export const EMPTY_OVERVIEW: Overview = {
  conversationsByState: Object.fromEntries(
    CONVERSATION_STATES.map((state) => [state, 0]),
  ) as Overview["conversationsByState"],
  totalLeads: 0,
  pendingInbound: 0,
};
