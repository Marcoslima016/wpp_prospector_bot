import { z } from "zod";
import { isoDateStringSchema } from "./common.ts";

/** Agrupamentos aceitos pelo endpoint de consumo. `category` = tipo de chamada ao LLM. */
export const CONSUMPTION_GROUP_BY = ["day", "lead", "model", "category"] as const;

export const consumptionGroupBySchema = z.enum(CONSUMPTION_GROUP_BY);

export const consumptionTotalsSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  /** Custo estimado em US$, derivado da tabela de preços versionada. */
  estimatedCostUsd: z.number().nonnegative(),
  /** `true` quando algum evento do grupo usa um modelo sem preço cadastrado. */
  costPartial: z.boolean(),
});

export const consumptionRowSchema = consumptionTotalsSchema.extend({
  /** Chave do grupo: dia (YYYY-MM-DD), telefone do lead, modelo ou tipo de chamada. */
  key: z.string(),
});

/** Série de consumo para um intervalo: linhas por grupo + total do intervalo. */
export const consumptionSeriesSchema = z.object({
  groupBy: consumptionGroupBySchema,
  range: z.object({ from: isoDateStringSchema, to: isoDateStringSchema }),
  rows: z.array(consumptionRowSchema),
  total: consumptionTotalsSchema,
});

export type ConsumptionTotals = z.infer<typeof consumptionTotalsSchema>;
export type ConsumptionRow = z.infer<typeof consumptionRowSchema>;
export type ConsumptionSeries = z.infer<typeof consumptionSeriesSchema>;
