import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../application/ports/logger.port.ts";
import type { WhatsappConversationEvent } from "../../application/ports/messaging-cost-recorder.port.ts";
import { openDatabase } from "../../../shared/persistence/sqlite/open-database.ts";
import { SqliteMessagingCostRecorder } from "./sqlite-messaging-cost-recorder.ts";
import { SqliteWhatsappCostQueries } from "./sqlite-whatsapp-cost-queries.ts";

let db: DatabaseSync;
let queries: SqliteWhatsappCostQueries;
let recorder: SqliteMessagingCostRecorder;

const logger: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

// Preços BR semeados em meta-conversation-prices.ts.
const MKT = 0.0625;
const UTIL = 0.008;

function seed(params: {
  occurredAt: string;
  conversationId: string;
  recipientId: string;
  category: WhatsappConversationEvent["category"];
  billable?: boolean;
}): Promise<void> {
  return recorder.recordConversationEvent({
    occurredAt: new Date(params.occurredAt),
    conversationId: params.conversationId,
    recipientId: params.recipientId,
    category: params.category,
    originType: "x",
    pricingModel: "CBP",
    billable: params.billable ?? true,
  });
}

const RANGE = { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-09-10T00:00:00Z") };

beforeEach(async () => {
  db = openDatabase(":memory:");
  queries = new SqliteWhatsappCostQueries(db);
  recorder = new SqliteMessagingCostRecorder(db, logger, "BR");

  await seed({
    occurredAt: "2026-09-02T10:00:00Z",
    conversationId: "c1",
    recipientId: "+55A",
    category: "marketing",
  });
  await seed({
    occurredAt: "2026-09-02T15:00:00Z",
    conversationId: "c2",
    recipientId: "+55A",
    category: "utility",
  });
  await seed({
    occurredAt: "2026-09-03T09:00:00Z",
    conversationId: "c3",
    recipientId: "+55B",
    category: "marketing",
  });
  // categoria sem preço → contagem mantida, custo parcial
  await seed({
    occurredAt: "2026-09-03T09:30:00Z",
    conversationId: "c4",
    recipientId: "+55B",
    category: "unknown",
  });
});

afterEach(() => {
  db.close();
});

describe("SqliteWhatsappCostQueries", () => {
  it("sumInRange conta janelas e marca costPartial quando há categoria sem preço", () => {
    const total = queries.sumInRange(RANGE);

    expect(total.conversations).toBe(4);
    expect(total.estimatedCostUsd).toBeCloseTo(MKT * 2 + UTIL, 6);
    expect(total.costPartial).toBe(true);
  });

  it("byDay retorna um bucket por dia UTC, ordenado", () => {
    const days = queries.byDay(RANGE);

    expect(days.map((d) => d.key)).toEqual(["2026-09-02", "2026-09-03"]);
    expect(days[0]!.conversations).toBe(2);
    expect(days[0]!.estimatedCostUsd).toBeCloseTo(MKT + UTIL, 6);
    expect(days[0]!.costPartial).toBe(false);
    expect(days[1]!.conversations).toBe(2);
    expect(days[1]!.costPartial).toBe(true);
  });

  it("byCategory isola a categoria sem preço: contagem mantida, custo do grupo partial e zero", () => {
    const cats = queries.byCategory(RANGE);

    expect(cats.map((c) => c.key)).toEqual(["marketing", "unknown", "utility"]);
    const unknown = cats.find((c) => c.key === "unknown")!;
    expect(unknown.conversations).toBe(1);
    expect(unknown.estimatedCostUsd).toBe(0);
    expect(unknown.costPartial).toBe(true);

    const marketing = cats.find((c) => c.key === "marketing")!;
    expect(marketing.conversations).toBe(2);
    expect(marketing.estimatedCostUsd).toBeCloseTo(MKT * 2, 6);
    expect(marketing.costPartial).toBe(false);
  });

  it("byLead agrupa por telefone do destinatário", () => {
    const leads = queries.byLead(RANGE);

    expect(leads.map((l) => l.key)).toEqual(["+55A", "+55B"]);
    expect(leads[0]!.conversations).toBe(2);
    expect(leads[1]!.costPartial).toBe(true);
  });

  it("intervalo sem eventos → zeros e listas vazias, sem erro", () => {
    const empty = { from: new Date("2020-01-01T00:00:00Z"), to: new Date("2020-02-01T00:00:00Z") };

    expect(queries.sumInRange(empty)).toEqual({
      conversations: 0,
      estimatedCostUsd: 0,
      costPartial: false,
    });
    expect(queries.byDay(empty)).toEqual([]);
    expect(queries.byCategory(empty)).toEqual([]);
  });

  it("o limite superior do intervalo é exclusivo", () => {
    const justBefore = {
      from: new Date("2026-09-01T00:00:00Z"),
      to: new Date("2026-09-03T09:00:00Z"),
    };

    expect(queries.byDay(justBefore).map((d) => d.key)).toEqual(["2026-09-02"]);
  });
});
