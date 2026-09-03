import type { DatabaseSync } from "node:sqlite";
import {
  SqliteLlmUsageQueries,
  type UsageBucket,
  type UsageTotals,
} from "../../conversation-engine/infrastructure/persistence/sqlite-llm-usage-queries.ts";
import type { ConsumptionSeries } from "../interface/dto/consumption.dto.ts";

export type ConsumptionGroupBy = ConsumptionSeries["groupBy"];

export interface ConsumptionStatsParams {
  from: Date;
  to: Date;
  groupBy: ConsumptionGroupBy;
}

/** Tabelas de eventos de consumo que precisam existir para haver dados. */
const LLM_USAGE_TABLE = "llm_usage_events";

const ZERO_TOTALS: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  estimatedCostUsd: 0,
  costPartial: false,
};

function stripKey(totals: UsageTotals & { key?: string }): UsageTotals {
  return {
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens,
    estimatedCostUsd: totals.estimatedCostUsd,
    costPartial: totals.costPartial,
  };
}

/**
 * Monta a série de consumo dos endpoints de estatísticas delegando às consultas
 * de agregação da capability `consumption-metrics`. Se as tabelas de eventos
 * ainda não existem neste deploy (as changes de tracking não subiram), trata
 * como "sem dados" e devolve série vazia / zeros — sem erro.
 */
export class ConsumptionStatsService {
  constructor(private readonly db: DatabaseSync) {}

  getSeries(params: ConsumptionStatsParams): ConsumptionSeries {
    const range = { from: params.from, to: params.to };
    const rangeDto = { from: params.from.toISOString(), to: params.to.toISOString() };

    if (!this.tableExists(LLM_USAGE_TABLE)) {
      return { groupBy: params.groupBy, range: rangeDto, rows: [], total: { ...ZERO_TOTALS } };
    }

    const llm = new SqliteLlmUsageQueries(this.db);
    const buckets = this.bucketsFor(llm, params.groupBy, range);

    return {
      groupBy: params.groupBy,
      range: rangeDto,
      rows: buckets.map((bucket) => ({ key: bucket.key, ...stripKey(bucket) })),
      total: stripKey(llm.sumInRange(range)),
    };
  }

  private bucketsFor(
    llm: SqliteLlmUsageQueries,
    groupBy: ConsumptionGroupBy,
    range: { from: Date; to: Date },
  ): UsageBucket[] {
    switch (groupBy) {
      case "day":
        return llm.byDay(range);
      case "lead":
        return llm.byLead(range);
      case "model":
        return llm.byModel(range);
      case "category":
        return llm.byCallType(range);
    }
  }

  private tableExists(name: string): boolean {
    const row = this.db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) as { ok: number } | undefined;
    return row !== undefined;
  }
}
