import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../application/ports/logger.port.ts";
import {
  HandleMessageStatusUpdateUseCase,
  type RawMessageStatusUpdate,
} from "../application/use-cases/handle-message-status-update.use-case.ts";
import { openDatabase } from "../../shared/persistence/sqlite/open-database.ts";
import { NoopMessagingCostRecorder } from "./persistence/noop-messaging-cost-recorder.ts";
import { SqliteMessagingCostRecorder } from "./persistence/sqlite-messaging-cost-recorder.ts";

const logger: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

let db: DatabaseSync;

afterEach(() => {
  db.close();
});

function statusEvent(status: RawMessageStatusUpdate["status"]): RawMessageStatusUpdate {
  return {
    id: `wamid.${status}`,
    status,
    timestamp: "1756814400",
    recipient_id: "5511999999999",
    pricing: { billable: true, pricing_model: "CBP", category: "marketing" },
    conversation: {
      id: "conv-window-1",
      origin: { type: "marketing" },
      expiration_timestamp: "1756900800",
    },
  };
}

function rows(): Array<{ conversation_id: string; category: string; billing_country: string }> {
  return db
    .prepare(
      "SELECT conversation_id, category, billing_country FROM whatsapp_conversation_events ORDER BY id",
    )
    .all() as unknown as Array<{
    conversation_id: string;
    category: string;
    billing_country: string;
  }>;
}

describe("fiação do registro de consumo de mensageria WhatsApp (integração)", () => {
  it("migration 0004 é aplicada por openDatabase e uma janela grava exatamente uma linha", async () => {
    db = openDatabase(":memory:");
    const useCase = new HandleMessageStatusUpdateUseCase(
      logger,
      new SqliteMessagingCostRecorder(db, logger, "BR"),
    );

    // Três status da MESMA janela de 24 h (sent → delivered → read).
    useCase.execute(statusEvent("sent"));
    useCase.execute(statusEvent("delivered"));
    useCase.execute(statusEvent("read"));
    await Promise.resolve();

    expect(rows()).toEqual([
      { conversation_id: "conv-window-1", category: "marketing", billing_country: "BR" },
    ]);
  });

  it("com WHATSAPP_COST_TRACKING_ENABLED=false (NoopMessagingCostRecorder) nenhuma linha é gravada", async () => {
    db = openDatabase(":memory:");
    const useCase = new HandleMessageStatusUpdateUseCase(logger, new NoopMessagingCostRecorder());

    useCase.execute(statusEvent("sent"));
    await Promise.resolve();

    expect(rows()).toEqual([]);
  });
});
