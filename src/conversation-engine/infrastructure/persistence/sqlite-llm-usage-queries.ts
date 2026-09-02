import type { DatabaseSync } from "node:sqlite";
import { costOf, priceFor } from "../pricing/anthropic-prices.ts";

export interface UsageRange {
  /** Início do intervalo, inclusivo. */
  from: Date;
  /** Fim do intervalo, exclusivo. */
  to: Date;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Custo estimado em US$, derivado da tabela de preços versionada. */
  estimatedCostUsd: number;
  /** `true` quando algum evento do grupo usa um modelo sem preço cadastrado. */
  costPartial: boolean;
}

export interface UsageBucket extends UsageTotals {
  /** Chave do grupo: dia (YYYY-MM-DD), telefone do lead, modelo ou tipo de chamada. */
  key: string;
}

interface GroupRow {
  bucket: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  first_occurred_at: string;
}

const EMPTY_TOTALS: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  estimatedCostUsd: 0,
  costPartial: false,
};

/**
 * Consultas de agregação sobre `llm_usage_events` — base para os endpoints de
 * estatísticas de consumo (change `add-management-api`). Não expõe rota nem
 * abre conexão: recebe a conexão já preparada por injeção.
 *
 * O SQL sempre agrupa por `(bucket, model)` e soma os contadores de token; o
 * custo é derivado em JS por `(bucket, model)` via `priceFor`/`costOf` (o preço
 * depende do modelo e da data) e re-somado no bucket pedido. Um modelo sem
 * preço cadastrado mantém os tokens no agregado e marca `costPartial`.
 */
export class SqliteLlmUsageQueries {
  constructor(private readonly db: DatabaseSync) {}

  /** Total do intervalo, sem agrupamento. Intervalo vazio → zeros. */
  sumInRange(range: UsageRange): UsageTotals {
    const buckets = this.aggregate("''", range);
    return buckets[0] ? stripKey(buckets[0]) : { ...EMPTY_TOTALS };
  }

  /** Um bucket por dia UTC (YYYY-MM-DD), ordenado por dia. */
  byDay(range: UsageRange): UsageBucket[] {
    return this.aggregate("substr(occurred_at, 1, 10)", range);
  }

  /** Um bucket por lead. Eventos sem lead associado caem na chave "". */
  byLead(range: UsageRange): UsageBucket[] {
    return this.aggregate("coalesce(lead_phone, '')", range);
  }

  /** Um bucket por modelo efetivamente usado. */
  byModel(range: UsageRange): UsageBucket[] {
    return this.aggregate("model", range);
  }

  /** Um bucket por tipo de chamada (`reply-generation` | `signal-extraction`). */
  byCallType(range: UsageRange): UsageBucket[] {
    return this.aggregate("call_type", range);
  }

  private aggregate(bucketExpr: string, range: UsageRange): UsageBucket[] {
    const rows = this.db
      .prepare(
        `SELECT ${bucketExpr} AS bucket,
                model,
                SUM(input_tokens)       AS input_tokens,
                SUM(output_tokens)      AS output_tokens,
                SUM(cache_read_tokens)  AS cache_read_tokens,
                SUM(cache_write_tokens) AS cache_write_tokens,
                MIN(occurred_at)        AS first_occurred_at
           FROM llm_usage_events
          WHERE occurred_at >= ? AND occurred_at < ?
          GROUP BY bucket, model`,
      )
      .all(range.from.toISOString(), range.to.toISOString()) as unknown as GroupRow[];

    const byKey = new Map<string, UsageBucket>();

    for (const row of rows) {
      const bucket = byKey.get(row.bucket) ?? { key: row.bucket, ...EMPTY_TOTALS };

      bucket.inputTokens += row.input_tokens;
      bucket.outputTokens += row.output_tokens;
      bucket.cacheReadTokens += row.cache_read_tokens;
      bucket.cacheWriteTokens += row.cache_write_tokens;

      const price = priceFor(row.model, new Date(row.first_occurred_at));
      if (price) {
        bucket.estimatedCostUsd += costOf(
          {
            inputTokens: row.input_tokens,
            outputTokens: row.output_tokens,
            cacheReadTokens: row.cache_read_tokens,
            cacheWriteTokens: row.cache_write_tokens,
          },
          price,
        );
      } else {
        bucket.costPartial = true;
      }

      byKey.set(row.bucket, bucket);
    }

    return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  }
}

function stripKey(bucket: UsageBucket): UsageTotals {
  return {
    inputTokens: bucket.inputTokens,
    outputTokens: bucket.outputTokens,
    cacheReadTokens: bucket.cacheReadTokens,
    cacheWriteTokens: bucket.cacheWriteTokens,
    estimatedCostUsd: bucket.estimatedCostUsd,
    costPartial: bucket.costPartial,
  };
}
