import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../../../shared/persistence/sqlite/open-database.ts";
import type { Logger } from "../../application/ports/logger.port.ts";
import { SqliteAdminActionAudit } from "./sqlite-admin-action-audit.ts";

let db: DatabaseSync | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

interface Row {
  occurred_at: string;
  actor: string;
  action: string;
  lead_phone: string;
  recorded_at: string;
}

function rows(): Row[] {
  return db!
    .prepare(
      "SELECT occurred_at, actor, action, lead_phone, recorded_at FROM admin_action_events ORDER BY id",
    )
    .all() as unknown as Row[];
}

describe("SqliteAdminActionAudit", () => {
  it("grava uma linha com os campos da ação e o recorded_at do relógio", async () => {
    db = openDatabase(":memory:");
    const audit = new SqliteAdminActionAudit(
      db,
      fakeLogger(),
      () => new Date("2026-09-02T15:30:00.000Z"),
    );

    await audit.record({
      actor: "operator",
      action: "handoff",
      leadPhone: "+5511988887777",
      occurredAt: new Date("2026-09-02T15:29:59.000Z"),
    });

    expect(rows()).toEqual([
      {
        occurred_at: "2026-09-02T15:29:59.000Z",
        actor: "operator",
        action: "handoff",
        lead_phone: "+5511988887777",
        recorded_at: "2026-09-02T15:30:00.000Z",
      },
    ]);
  });

  it("acumula uma linha por chamada (append-only)", async () => {
    db = openDatabase(":memory:");
    const audit = new SqliteAdminActionAudit(db, fakeLogger());

    await audit.record({
      actor: "operator",
      action: "handoff",
      leadPhone: "+5511988887777",
      occurredAt: new Date("2026-09-02T15:00:00.000Z"),
    });
    await audit.record({
      actor: "operator",
      action: "resume",
      leadPhone: "+5511988887777",
      occurredAt: new Date("2026-09-02T15:05:00.000Z"),
    });
    await audit.record({
      actor: "operator",
      action: "send-message",
      leadPhone: "+5511988887777",
      occurredAt: new Date("2026-09-02T15:06:00.000Z"),
    });

    expect(rows().map((r) => r.action)).toEqual(["handoff", "resume", "send-message"]);
  });

  it("grava a ação reset_prospecting", async () => {
    db = openDatabase(":memory:");
    const audit = new SqliteAdminActionAudit(db, fakeLogger());

    await audit.record({
      actor: "operator",
      action: "reset_prospecting",
      leadPhone: "+5511988887777",
      occurredAt: new Date("2026-09-03T15:00:00.000Z"),
    });

    expect(rows().map((r) => r.action)).toEqual(["reset_prospecting"]);
  });
});
