import type { DatabaseSync } from "node:sqlite";
import { costOf, priceFor } from "../pricing/meta-conversation-prices.ts";
import type { ConversationCategory } from "../../domain/whatsapp-conversation-billing.ts";

export interface CostRange {
  /** Início do intervalo, inclusivo. */
  from: Date;
  /** Fim do intervalo, exclusivo. */
  to: Date;
}

export interface CostTotals {
  /** Número de janelas de conversa de 24 h registradas. */
  conversations: number;
  /** Custo estimado em US$, derivado da tabela de preços da Meta versionada. */
  estimatedCostUsd: number;
  /** `true` quando algum grupo tem categoria/país sem preço cadastrado. */
  costPartial: boolean;
}

export interface CostBucket extends CostTotals {
  /** Chave do grupo: dia (YYYY-MM-DD), categoria ou telefone do lead. */
  key: string;
}

interface GroupRow {
  bucket: string;
  category: string;
  billing_country: string;
  conversations: number;
  first_occurred_at: string;
}

const EMPTY_TOTALS: CostTotals = {
  conversations: 0,
  estimatedCostUsd: 0,
  costPartial: false,
};

/**
 * Consultas de agregação sobre `whatsapp_conversation_events` — fonte WhatsApp da
 * capability `consumption-metrics`, base para os endpoints de estatísticas de
 * consumo (change `add-management-api`). Não expõe rota nem abre conexão: recebe
 * a conexão já preparada por injeção.
 *
 * O SQL sempre agrupa por `(bucket, category, billing_country)` e conta janelas;
 * o custo é derivado em JS por grupo via `priceFor`/`costOf` (o preço depende da
 * categoria, do país-base e da data) e re-somado no bucket pedido. Uma
 * combinação categoria/país sem preço mantém a contagem e marca `costPartial`.
 */
export class SqliteWhatsappCostQueries {
  constructor(private readonly db: DatabaseSync) {}

  /** Total do intervalo, sem agrupamento. Intervalo vazio → zeros. */
  sumInRange(range: CostRange): CostTotals {
    const buckets = this.aggregate("''", range);
    return buckets[0] ? stripKey(buckets[0]) : { ...EMPTY_TOTALS };
  }

  /** Um bucket por dia UTC (YYYY-MM-DD), ordenado por dia. */
  byDay(range: CostRange): CostBucket[] {
    return this.aggregate("substr(occurred_at, 1, 10)", range);
  }

  /** Um bucket por categoria de conversa (`marketing`/`utility`/… ou `unknown`). */
  byCategory(range: CostRange): CostBucket[] {
    return this.aggregate("category", range);
  }

  /** Um bucket por lead (telefone do destinatário). */
  byLead(range: CostRange): CostBucket[] {
    return this.aggregate("recipient_id", range);
  }

  private aggregate(bucketExpr: string, range: CostRange): CostBucket[] {
    const rows = this.db
      .prepare(
        `SELECT ${bucketExpr} AS bucket,
                category,
                billing_country,
                COUNT(*)        AS conversations,
                MIN(occurred_at) AS first_occurred_at
           FROM whatsapp_conversation_events
          WHERE occurred_at >= ? AND occurred_at < ?
          GROUP BY bucket, category, billing_country`,
      )
      .all(range.from.toISOString(), range.to.toISOString()) as unknown as GroupRow[];

    const byKey = new Map<string, CostBucket>();

    for (const row of rows) {
      const bucket = byKey.get(row.bucket) ?? { key: row.bucket, ...EMPTY_TOTALS };

      bucket.conversations += row.conversations;

      const price = priceFor(
        row.category as ConversationCategory | "unknown",
        row.billing_country,
        new Date(row.first_occurred_at),
      );
      if (price) {
        bucket.estimatedCostUsd += costOf(row.conversations, price);
      } else {
        bucket.costPartial = true;
      }

      byKey.set(row.bucket, bucket);
    }

    return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  }
}

function stripKey(bucket: CostBucket): CostTotals {
  return {
    conversations: bucket.conversations,
    estimatedCostUsd: bucket.estimatedCostUsd,
    costPartial: bucket.costPartial,
  };
}
