import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../../shared/persistence/sqlite/open-database.ts";
import { buildConversation, type ConversationSpec } from "../../test-support/conversation-fixtures.ts";
import { ConversationIndexProjection } from "./conversation-index-projection.ts";
import { ConversationIndexQueries } from "./conversation-index-queries.ts";

let db: DatabaseSync;
let queries: ConversationIndexQueries;

const SPECS: ConversationSpec[] = [
  { leadPhone: "+5511900000001", at: new Date("2026-09-01T10:00:00.000Z"), intent: "interested" },
  {
    leadPhone: "+5511900000002",
    at: new Date("2026-09-03T10:00:00.000Z"),
    intent: "needs_more_info",
    pendingInbound: true,
  },
  {
    leadPhone: "+5511900000003",
    at: new Date("2026-09-02T10:00:00.000Z"),
    intent: "interested",
    handoff: true,
  },
  {
    leadPhone: "+5511955555555",
    at: new Date("2026-09-04T10:00:00.000Z"),
    intent: "not_interested",
    end: true,
  },
];

function seed(specs: ConversationSpec[]): void {
  const projection = new ConversationIndexProjection(db);
  for (const spec of specs) projection.upsertFromConversation(buildConversation(spec));
}

beforeEach(() => {
  db = openDatabase(":memory:");
  queries = new ConversationIndexQueries(db);
});

afterEach(() => {
  db.close();
});

describe("ConversationIndexQueries.list", () => {
  it("sem filtro: ordena por última atividade desc", () => {
    seed(SPECS);
    const page = queries.list({ limit: 10 });

    expect(page.items.map((i) => i.leadPhone)).toEqual([
      "+5511955555555",
      "+5511900000002",
      "+5511900000003",
      "+5511900000001",
    ]);
    expect(page.pageSize).toBe(10);
    expect(page.nextCursor).toBeNull();
  });

  it("pagina por keyset com o cursor", () => {
    seed(SPECS);

    const first = queries.list({ limit: 2 });
    expect(first.items.map((i) => i.leadPhone)).toEqual(["+5511955555555", "+5511900000002"]);
    expect(first.nextCursor).not.toBeNull();

    const second = queries.list({ limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((i) => i.leadPhone)).toEqual(["+5511900000003", "+5511900000001"]);
    expect(second.nextCursor).toBeNull();
  });

  it("filtra por estado", () => {
    seed(SPECS);
    const page = queries.list({ limit: 10, state: "active" });

    expect(page.items.map((i) => i.leadPhone)).toEqual(["+5511900000002", "+5511900000001"]);
  });

  it("combina intent do lead + faixa de data de última atividade", () => {
    seed(SPECS);
    const page = queries.list({
      limit: 10,
      leadIntent: "interested",
      activityFrom: "2026-09-01T12:00:00.000Z",
    });

    expect(page.items.map((i) => i.leadPhone)).toEqual(["+5511900000003"]);
  });

  it("busca por trecho do telefone", () => {
    seed(SPECS);
    const page = queries.list({ limit: 10, phone: "95555" });

    expect(page.items.map((i) => i.leadPhone)).toEqual(["+5511955555555"]);
  });

  it("nenhum match → página vazia sem erro", () => {
    seed(SPECS);
    const page = queries.list({ limit: 10, state: "ended", phone: "900000001" });

    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it("mapeia os campos do item de lista", () => {
    seed([SPECS[1]!]);
    const [item] = queries.list({ limit: 10 }).items;

    expect(item).toEqual({
      leadPhone: "+5511900000002",
      state: "active",
      leadIntent: "needs_more_info",
      leadQualification: "warm",
      turnCount: 3,
      lastActivityAt: "2026-09-03T10:01:00.000Z",
      hasPendingInbound: true,
      quotedPlan: null,
    });
  });
});

describe("ConversationIndexQueries.overview", () => {
  it("conta conversas por estado, total de leads e pendências", () => {
    seed(SPECS);

    expect(queries.overview()).toEqual({
      conversationsByState: { active: 2, ended: 1, awaitingHuman: 1 },
      totalLeads: 4,
      pendingInbound: 1,
    });
  });

  it("índice vazio → tudo zerado", () => {
    expect(queries.overview()).toEqual({
      conversationsByState: { active: 0, ended: 0, awaitingHuman: 0 },
      totalLeads: 0,
      pendingInbound: 0,
    });
  });
});
