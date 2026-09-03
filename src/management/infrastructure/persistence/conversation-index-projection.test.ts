import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { Conversation } from "../../../conversation-engine/domain/conversation.ts";
import { openDatabase } from "../../../shared/persistence/sqlite/open-database.ts";
import { buildConversation } from "../../test-support/conversation-fixtures.ts";
import {
  ConversationIndexProjection,
  deriveIndexRow,
} from "./conversation-index-projection.ts";

let db: DatabaseSync | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

function rowFor(leadPhone: string) {
  return db!
    .prepare("SELECT * FROM conversation_index WHERE lead_phone = ?")
    .get(leadPhone) as Record<string, unknown> | undefined;
}

const t0 = new Date("2026-09-02T12:00:00.000Z");
const clock = () => new Date("2026-09-02T15:00:00.000Z");

describe("deriveIndexRow", () => {
  it("deriva os campos do agregado", () => {
    const conversation = buildConversation({
      leadPhone: "+5511900000001",
      at: t0,
      intent: "needs_more_info",
      qualification: "hot",
      quotedPlan: "essencial",
      pendingInbound: true,
    });

    const row = deriveIndexRow(conversation, clock());

    expect(row).toEqual({
      lead_phone: "+5511900000001",
      state: "active",
      lead_intent: "needs_more_info",
      lead_qualification: "hot",
      turn_count: 3,
      last_activity_at: new Date(t0.getTime() + 60_000).toISOString(),
      has_pending_inbound: 1,
      quoted_plan: "essencial",
      updated_at: clock().toISOString(),
    });
  });

  it("last_activity_at é null quando não há turnos", () => {
    const row = deriveIndexRow(Conversation.createNew("+5511900000009"), clock());
    expect(row.last_activity_at).toBeNull();
    expect(row.turn_count).toBe(0);
  });
});

describe("ConversationIndexProjection", () => {
  it("upsertFromConversation insere e depois atualiza a mesma linha", () => {
    db = openDatabase(":memory:");
    const projection = new ConversationIndexProjection(db, clock);

    projection.upsertFromConversation(
      buildConversation({ leadPhone: "+5511900000002", at: t0, intent: "interested" }),
    );
    expect(rowFor("+5511900000002")).toMatchObject({ lead_intent: "interested", state: "active" });

    projection.upsertFromConversation(
      buildConversation({ leadPhone: "+5511900000002", at: t0, intent: "opt_out", end: true }),
    );

    const after = rowFor("+5511900000002")!;
    expect(after).toMatchObject({ lead_intent: "opt_out", state: "ended" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM conversation_index").get()).toEqual({ n: 1 });
  });

  it("isEmptyOrStale é true só enquanto o índice está vazio", () => {
    db = openDatabase(":memory:");
    const projection = new ConversationIndexProjection(db, clock);

    expect(projection.isEmptyOrStale()).toBe(true);
    projection.upsertFromConversation(buildConversation({ leadPhone: "+5511900000003", at: t0 }));
    expect(projection.isEmptyOrStale()).toBe(false);
  });

  it("rebuildFromDir popula uma linha por arquivo .json", async () => {
    db = openDatabase(":memory:");
    const dir = await mkdtemp(join(tmpdir(), "conv-index-"));

    for (const [phone, spec] of [
      ["5511900000004", { leadPhone: "+5511900000004", at: t0, intent: "interested" as const }],
      [
        "5511900000005",
        { leadPhone: "+5511900000005", at: t0, intent: "not_interested" as const, end: true },
      ],
    ] as const) {
      await writeFile(
        join(dir, `${phone}.json`),
        JSON.stringify(buildConversation(spec).toJSON()),
        "utf8",
      );
    }
    await writeFile(join(dir, "ignore.txt"), "não é conversa", "utf8");

    const projection = new ConversationIndexProjection(db, clock);
    const count = await projection.rebuildFromDir(dir);

    expect(count).toBe(2);
    expect(db.prepare("SELECT COUNT(*) AS n FROM conversation_index").get()).toEqual({ n: 2 });
    expect(rowFor("+5511900000005")).toMatchObject({ state: "ended", lead_intent: "not_interested" });
  });

  it("rebuildFromDir com diretório inexistente devolve 0 sem lançar", async () => {
    db = openDatabase(":memory:");
    const projection = new ConversationIndexProjection(db, clock);

    await expect(projection.rebuildFromDir(join(tmpdir(), "nao-existe-xyz"))).resolves.toBe(0);
  });

  it("rebuildFromDir substitui linhas órfãs", async () => {
    db = openDatabase(":memory:");
    const projection = new ConversationIndexProjection(db, clock);
    projection.upsertFromConversation(buildConversation({ leadPhone: "+5511900000099", at: t0 }));

    const dir = await mkdtemp(join(tmpdir(), "conv-index-"));
    await writeFile(
      join(dir, "5511900000004.json"),
      JSON.stringify(buildConversation({ leadPhone: "+5511900000004", at: t0 }).toJSON()),
      "utf8",
    );

    await projection.rebuildFromDir(dir);

    expect(rowFor("+5511900000099")).toBeUndefined();
    expect(rowFor("+5511900000004")).toBeDefined();
  });
});
