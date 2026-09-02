import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../application/ports/logger.port.ts";
import type { LlmCallType, LlmUsageEvent } from "../../application/ports/usage-recorder.port.ts";
import { openDatabase } from "../../../shared/persistence/sqlite/open-database.ts";
import { SqliteLlmUsageQueries } from "./sqlite-llm-usage-queries.ts";
import { SqliteUsageRecorder } from "./sqlite-usage-recorder.ts";

let db: DatabaseSync;
let queries: SqliteLlmUsageQueries;
let recorder: SqliteUsageRecorder;

const logger: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function seed(params: {
  occurredAt: string;
  callType: LlmCallType;
  leadPhone?: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): Promise<void> {
  const event: LlmUsageEvent = {
    occurredAt: new Date(params.occurredAt),
    callType: params.callType,
    leadPhone: params.leadPhone,
    usage: {
      model: params.model,
      inputTokens: params.inputTokens ?? 0,
      outputTokens: params.outputTokens ?? 0,
      cacheReadTokens: params.cacheReadTokens ?? 0,
      cacheWriteTokens: params.cacheWriteTokens ?? 0,
    },
  };
  return recorder.recordLlmCall(event);
}

const RANGE = { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-09-10T00:00:00Z") };

beforeEach(async () => {
  db = openDatabase(":memory:");
  queries = new SqliteLlmUsageQueries(db);
  recorder = new SqliteUsageRecorder(db, logger);

  await seed({
    occurredAt: "2026-09-02T10:00:00Z",
    callType: "reply-generation",
    leadPhone: "+55A",
    model: "claude-sonnet-5",
    inputTokens: 1_000_000,
  });
  await seed({
    occurredAt: "2026-09-02T10:00:01Z",
    callType: "signal-extraction",
    leadPhone: "+55A",
    model: "claude-haiku-4-5",
    inputTokens: 2_000_000,
  });
  await seed({
    occurredAt: "2026-09-03T09:00:00Z",
    callType: "reply-generation",
    leadPhone: "+55B",
    model: "claude-sonnet-5",
    outputTokens: 1_000_000,
  });
  await seed({
    occurredAt: "2026-09-03T09:30:00Z",
    callType: "reply-generation",
    leadPhone: "+55B",
    model: "modelo-desconhecido",
    inputTokens: 500,
  });
});

afterEach(() => {
  db.close();
});

describe("SqliteLlmUsageQueries", () => {
  it("sumInRange soma todos os contadores e marca costPartial quando há modelo sem preço", () => {
    const total = queries.sumInRange(RANGE);

    expect(total.inputTokens).toBe(3_000_500);
    expect(total.outputTokens).toBe(1_000_000);
    // sonnet: 1M input ($3) + 1M output ($15); haiku: 2M input ($2); desconhecido: sem custo
    expect(total.estimatedCostUsd).toBeCloseTo(3 + 15 + 2, 6);
    expect(total.costPartial).toBe(true);
  });

  it("byDay retorna um bucket por dia UTC, ordenado", () => {
    const days = queries.byDay(RANGE);

    expect(days.map((d) => d.key)).toEqual(["2026-09-02", "2026-09-03"]);
    expect(days[0]!.inputTokens).toBe(3_000_000);
    expect(days[1]!.outputTokens).toBe(1_000_000);
    expect(days[1]!.costPartial).toBe(true);
  });

  it("byLead agrupa por telefone do lead", () => {
    const leads = queries.byLead(RANGE);

    expect(leads.map((l) => l.key)).toEqual(["+55A", "+55B"]);
    expect(leads[0]!.inputTokens).toBe(3_000_000);
  });

  it("byModel isola o modelo sem preço: tokens somados, custo do grupo partial e zero", () => {
    const models = queries.byModel(RANGE);

    expect(models.map((m) => m.key)).toEqual([
      "claude-haiku-4-5",
      "claude-sonnet-5",
      "modelo-desconhecido",
    ]);
    const unknown = models.find((m) => m.key === "modelo-desconhecido")!;
    expect(unknown.inputTokens).toBe(500);
    expect(unknown.estimatedCostUsd).toBe(0);
    expect(unknown.costPartial).toBe(true);

    const sonnet = models.find((m) => m.key === "claude-sonnet-5")!;
    expect(sonnet.estimatedCostUsd).toBeCloseTo(3 + 15, 6);
    expect(sonnet.costPartial).toBe(false);
  });

  it("byCallType agrupa por tipo de chamada", () => {
    const kinds = queries.byCallType(RANGE);

    expect(kinds.map((k) => k.key)).toEqual(["reply-generation", "signal-extraction"]);
  });

  it("intervalo sem eventos → zeros e listas vazias, sem erro", () => {
    const empty = { from: new Date("2020-01-01T00:00:00Z"), to: new Date("2020-02-01T00:00:00Z") };

    expect(queries.sumInRange(empty)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUsd: 0,
      costPartial: false,
    });
    expect(queries.byDay(empty)).toEqual([]);
    expect(queries.byModel(empty)).toEqual([]);
  });

  it("o limite superior do intervalo é exclusivo", () => {
    const justBefore = {
      from: new Date("2026-09-01T00:00:00Z"),
      to: new Date("2026-09-03T09:00:00Z"),
    };

    const days = queries.byDay(justBefore);
    // o evento de 09-03T09:00:00Z fica de fora
    expect(days.map((d) => d.key)).toEqual(["2026-09-02"]);
  });
});
