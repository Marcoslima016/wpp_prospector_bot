import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../application/ports/logger.port.ts";
import type { LlmUsageEvent } from "../../application/ports/usage-recorder.port.ts";
import { openDatabase } from "../../../shared/persistence/sqlite/open-database.ts";
import { PRICE_TABLE_VERSION } from "../pricing/anthropic-prices.ts";
import { SqliteUsageRecorder } from "./sqlite-usage-recorder.ts";

let db: DatabaseSync | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function event(overrides: Partial<LlmUsageEvent> = {}): LlmUsageEvent {
  return {
    occurredAt: new Date("2026-09-02T12:00:00.000Z"),
    callType: "reply-generation",
    leadPhone: "+5511999999999",
    usage: {
      model: "claude-sonnet-5",
      inputTokens: 1200,
      outputTokens: 300,
      cacheReadTokens: 800,
      cacheWriteTokens: 64,
      requestId: "req_abc",
    },
    ...overrides,
  };
}

interface Row {
  occurred_at: string;
  call_type: string;
  lead_phone: string | null;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  request_id: string | null;
  price_version: string;
  recorded_at: string;
}

function rows(): Row[] {
  return db!.prepare("SELECT * FROM llm_usage_events ORDER BY id").all() as unknown as Row[];
}

describe("SqliteUsageRecorder", () => {
  it("grava uma linha por chamada com os contadores, price_version e recorded_at", async () => {
    db = openDatabase(":memory:");
    const recorder = new SqliteUsageRecorder(
      db,
      fakeLogger(),
      () => new Date("2026-09-02T12:00:05.000Z"),
    );

    await recorder.recordLlmCall(event());

    expect(rows()).toEqual([
      {
        id: 1,
        occurred_at: "2026-09-02T12:00:00.000Z",
        call_type: "reply-generation",
        lead_phone: "+5511999999999",
        model: "claude-sonnet-5",
        input_tokens: 1200,
        output_tokens: 300,
        cache_read_tokens: 800,
        cache_write_tokens: 64,
        request_id: "req_abc",
        price_version: PRICE_TABLE_VERSION,
        recorded_at: "2026-09-02T12:00:05.000Z",
      },
    ]);
  });

  it("grava lead_phone e request_id como NULL quando ausentes", async () => {
    db = openDatabase(":memory:");
    const recorder = new SqliteUsageRecorder(db, fakeLogger());

    await recorder.recordLlmCall(
      event({
        callType: "signal-extraction",
        leadPhone: undefined,
        usage: {
          model: "claude-haiku-4-5-20251001",
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      }),
    );

    const [row] = rows();
    expect(row!.lead_phone).toBeNull();
    expect(row!.request_id).toBeNull();
    expect(row!.call_type).toBe("signal-extraction");
  });

  it("acrescenta linhas — nunca atualiza um acumulado", async () => {
    db = openDatabase(":memory:");
    const recorder = new SqliteUsageRecorder(db, fakeLogger());

    await recorder.recordLlmCall(event());
    await recorder.recordLlmCall(event({ callType: "signal-extraction" }));

    expect(rows().map((r) => r.call_type)).toEqual(["reply-generation", "signal-extraction"]);
  });

  it("engole o erro de escrita, loga warn e não rejeita", async () => {
    db = openDatabase(":memory:");
    const logger = fakeLogger();
    const recorder = new SqliteUsageRecorder(db, logger);
    db.exec("DROP TABLE llm_usage_events");

    await expect(recorder.recordLlmCall(event())).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Falha ao registrar consumo"),
      expect.objectContaining({ callType: "reply-generation" }),
    );
  });
});
