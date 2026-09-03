import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../application/ports/logger.port.ts";
import type { WhatsappConversationEvent } from "../../application/ports/messaging-cost-recorder.port.ts";
import { openDatabase } from "../../../shared/persistence/sqlite/open-database.ts";
import { META_PRICE_TABLE_VERSION } from "../pricing/meta-conversation-prices.ts";
import { SqliteMessagingCostRecorder } from "./sqlite-messaging-cost-recorder.ts";

let db: DatabaseSync | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function event(overrides: Partial<WhatsappConversationEvent> = {}): WhatsappConversationEvent {
  return {
    occurredAt: new Date("2026-09-02T12:00:00.000Z"),
    conversationId: "conv-1",
    recipientId: "5511999999999",
    category: "marketing",
    originType: "marketing",
    pricingModel: "CBP",
    billable: true,
    expirationTimestamp: new Date("2026-09-03T12:00:00.000Z"),
    ...overrides,
  };
}

interface Row {
  occurred_at: string;
  conversation_id: string;
  recipient_id: string;
  category: string;
  origin_type: string;
  pricing_model: string;
  billable: number;
  expiration_timestamp: string | null;
  billing_country: string;
  price_version: string;
  recorded_at: string;
}

function rows(): Row[] {
  return db!
    .prepare("SELECT * FROM whatsapp_conversation_events ORDER BY id")
    .all() as unknown as Row[];
}

describe("SqliteMessagingCostRecorder", () => {
  it("grava uma linha por janela com billing_country, price_version e recorded_at", async () => {
    db = openDatabase(":memory:");
    const recorder = new SqliteMessagingCostRecorder(
      db,
      fakeLogger(),
      "BR",
      () => new Date("2026-09-02T12:00:05.000Z"),
    );

    await recorder.recordConversationEvent(event());

    expect(rows()).toEqual([
      {
        id: 1,
        occurred_at: "2026-09-02T12:00:00.000Z",
        conversation_id: "conv-1",
        recipient_id: "5511999999999",
        category: "marketing",
        origin_type: "marketing",
        pricing_model: "CBP",
        billable: 1,
        expiration_timestamp: "2026-09-03T12:00:00.000Z",
        billing_country: "BR",
        price_version: META_PRICE_TABLE_VERSION,
        recorded_at: "2026-09-02T12:00:05.000Z",
      },
    ]);
  });

  it("deduplica por conversationId — segundo evento não cria nem altera a linha", async () => {
    db = openDatabase(":memory:");
    const recorder = new SqliteMessagingCostRecorder(db, fakeLogger(), "BR");

    await recorder.recordConversationEvent(event({ category: "marketing", billable: true }));
    await recorder.recordConversationEvent(
      event({ category: "utility", billable: false, recipientId: "outro" }),
    );

    const all = rows();
    expect(all).toHaveLength(1);
    expect(all[0]!.category).toBe("marketing");
    expect(all[0]!.billable).toBe(1);
    expect(all[0]!.recipient_id).toBe("5511999999999");
  });

  it("grava expiration_timestamp NULL quando ausente", async () => {
    db = openDatabase(":memory:");
    const recorder = new SqliteMessagingCostRecorder(db, fakeLogger(), "BR");

    await recorder.recordConversationEvent(event({ expirationTimestamp: undefined }));

    expect(rows()[0]!.expiration_timestamp).toBeNull();
  });

  it("acrescenta linhas para janelas distintas", async () => {
    db = openDatabase(":memory:");
    const recorder = new SqliteMessagingCostRecorder(db, fakeLogger(), "BR");

    await recorder.recordConversationEvent(event({ conversationId: "conv-1" }));
    await recorder.recordConversationEvent(event({ conversationId: "conv-2" }));

    expect(rows().map((r) => r.conversation_id)).toEqual(["conv-1", "conv-2"]);
  });

  it("engole o erro de escrita, loga warn e não rejeita", async () => {
    db = openDatabase(":memory:");
    const logger = fakeLogger();
    const recorder = new SqliteMessagingCostRecorder(db, logger, "BR");
    db.exec("DROP TABLE whatsapp_conversation_events");

    await expect(recorder.recordConversationEvent(event())).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Falha ao registrar consumo de mensageria"),
      expect.objectContaining({ conversationId: "conv-1" }),
    );
  });
});
