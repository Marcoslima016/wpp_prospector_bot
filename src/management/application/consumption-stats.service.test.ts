import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../shared/persistence/sqlite/open-database.ts";
import { ConsumptionStatsService } from "./consumption-stats.service.ts";

let db: DatabaseSync;
let service: ConsumptionStatsService;

const RANGE = { from: new Date("2026-09-01T00:00:00.000Z"), to: new Date("2026-09-03T00:00:00.000Z") };

interface EventInput {
  occurredAt: string;
  callType: "reply-generation" | "signal-extraction";
  leadPhone: string | null;
  model: string;
  input: number;
  output: number;
}

function insert(event: EventInput): void {
  db.prepare(
    `INSERT INTO llm_usage_events
       (occurred_at, call_type, lead_phone, model, input_tokens, output_tokens,
        cache_read_tokens, cache_write_tokens, request_id, price_version, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, NULL, '2026-09-01', ?)`,
  ).run(
    event.occurredAt,
    event.callType,
    event.leadPhone,
    event.model,
    event.input,
    event.output,
    event.occurredAt,
  );
}

const EVENTS: EventInput[] = [
  {
    occurredAt: "2026-09-01T10:00:00.000Z",
    callType: "reply-generation",
    leadPhone: "+5511900000001",
    model: "claude-sonnet-5",
    input: 1000,
    output: 200,
  },
  {
    occurredAt: "2026-09-01T12:00:00.000Z",
    callType: "signal-extraction",
    leadPhone: "+5511900000001",
    model: "claude-haiku-4-5",
    input: 500,
    output: 50,
  },
  {
    occurredAt: "2026-09-02T09:00:00.000Z",
    callType: "reply-generation",
    leadPhone: "+5511900000002",
    model: "claude-sonnet-5",
    input: 800,
    output: 100,
  },
];

beforeEach(() => {
  db = openDatabase(":memory:");
  service = new ConsumptionStatsService(db);
});

afterEach(() => {
  db.close();
});

function sumField(rows: Array<{ inputTokens: number }>, field: "inputTokens"): number {
  return rows.reduce((acc, row) => acc + row[field], 0);
}

describe("ConsumptionStatsService", () => {
  it("agrupa por dia e o total bate com a soma das linhas", () => {
    EVENTS.forEach(insert);
    const series = service.getSeries({ ...RANGE, groupBy: "day" });

    expect(series.groupBy).toBe("day");
    expect(series.rows.map((r) => r.key)).toEqual(["2026-09-01", "2026-09-02"]);
    expect(sumField(series.rows, "inputTokens")).toBe(2300);
    expect(series.total.inputTokens).toBe(2300);
    expect(series.total.outputTokens).toBe(350);
    expect(series.total.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("agrupa por lead, modelo e categoria", () => {
    EVENTS.forEach(insert);

    expect(service.getSeries({ ...RANGE, groupBy: "lead" }).rows.map((r) => r.key).sort()).toEqual([
      "+5511900000001",
      "+5511900000002",
    ]);
    expect(service.getSeries({ ...RANGE, groupBy: "model" }).rows.map((r) => r.key).sort()).toEqual([
      "claude-haiku-4-5",
      "claude-sonnet-5",
    ]);
    expect(
      service.getSeries({ ...RANGE, groupBy: "category" }).rows.map((r) => r.key).sort(),
    ).toEqual(["reply-generation", "signal-extraction"]);
  });

  it("intervalo sem eventos → série vazia / zeros", () => {
    const series = service.getSeries({ ...RANGE, groupBy: "day" });

    expect(series.rows).toEqual([]);
    expect(series.total).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUsd: 0,
      costPartial: false,
    });
  });

  it("sem a tabela de eventos de consumo → série vazia / zeros, sem erro", () => {
    db.exec("DROP TABLE llm_usage_events");
    const series = service.getSeries({ ...RANGE, groupBy: "model" });

    expect(series.rows).toEqual([]);
    expect(series.total.inputTokens).toBe(0);
  });
});
