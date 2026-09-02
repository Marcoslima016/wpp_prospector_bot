import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { Logger } from "../../application/ports/logger.port.ts";
import type {
  LlmUsageEvent,
  UsageRecorderPort,
} from "../../application/ports/usage-recorder.port.ts";
import { PRICE_TABLE_VERSION } from "../pricing/anthropic-prices.ts";

const INSERT_SQL = `
  INSERT INTO llm_usage_events
    (occurred_at, call_type, lead_phone, model, input_tokens, output_tokens,
     cache_read_tokens, cache_write_tokens, request_id, price_version, recorded_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

/**
 * Adapter de `UsageRecorderPort` sobre o armazenamento SQL embutido. Grava uma
 * linha append-only por chamada ao LLM. Best-effort: `recordLlmCall` nunca
 * rejeita nem lança — uma falha de escrita é logada e o evento é descartado.
 */
export class SqliteUsageRecorder implements UsageRecorderPort {
  private readonly insert: StatementSync;

  constructor(
    db: DatabaseSync,
    private readonly logger: Logger,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.insert = db.prepare(INSERT_SQL);
  }

  recordLlmCall(event: LlmUsageEvent): Promise<void> {
    try {
      this.insert.run(
        event.occurredAt.toISOString(),
        event.callType,
        event.leadPhone ?? null,
        event.usage.model,
        event.usage.inputTokens,
        event.usage.outputTokens,
        event.usage.cacheReadTokens,
        event.usage.cacheWriteTokens,
        event.usage.requestId ?? null,
        PRICE_TABLE_VERSION,
        this.clock().toISOString(),
      );
    } catch (error) {
      this.logger.warn("Falha ao registrar consumo de LLM — evento descartado", {
        callType: event.callType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return Promise.resolve();
  }
}
