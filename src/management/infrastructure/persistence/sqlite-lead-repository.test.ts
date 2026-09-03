import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../../../shared/persistence/sqlite/open-database.ts";
import type { Logger } from "../../application/ports/logger.port.ts";
import { SqliteLeadRepository } from "./sqlite-lead-repository.ts";

let db: DatabaseSync | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function repo(clock?: () => Date): SqliteLeadRepository {
  db = openDatabase(":memory:");
  return new SqliteLeadRepository(db, fakeLogger(), clock);
}

describe("SqliteLeadRepository", () => {
  it("upsert de um telefone novo cria o lead em estado pending", async () => {
    const leads = repo();

    const record = await leads.upsert({ phone: "+5511988887777", displayName: "Ana", source: "ads" });

    expect(record).toMatchObject({
      phone: "+5511988887777",
      displayName: "Ana",
      source: "ads",
      notes: null,
      prospectingState: "pending",
      firstContactWamid: null,
      firstContactAt: null,
      repliedAt: null,
    });
  });

  it("upsert repetido do mesmo telefone não duplica e preserva o estado de prospecção", async () => {
    const leads = repo();

    await leads.upsert({ phone: "+5511988887777", displayName: "Ana" });
    await leads.markProspected("+5511988887777", "wamid.1", new Date("2026-09-03T10:00:00.000Z"));
    const updated = await leads.upsert({ phone: "+5511988887777", notes: "ligar à tarde" });

    expect(updated.prospectingState).toBe("sent");
    expect(updated.displayName).toBe("Ana");
    expect(updated.notes).toBe("ligar à tarde");
    expect(updated.firstContactWamid).toBe("wamid.1");

    const count = db!.prepare("SELECT COUNT(*) AS n FROM leads").get() as { n: number };
    expect(count.n).toBe(1);
  });

  it("findByPhone devolve null quando o lead não existe", async () => {
    const leads = repo();
    expect(await leads.findByPhone("+5511900000000")).toBeNull();
  });

  it("markProspected leva o lead a sent com wamid e first_contact_at", async () => {
    const leads = repo();
    await leads.upsert({ phone: "+5511988887777" });

    await leads.markProspected("+5511988887777", "wamid.42", new Date("2026-09-03T12:00:00.000Z"));

    const record = await leads.findByPhone("+5511988887777");
    expect(record).toMatchObject({
      prospectingState: "sent",
      firstContactWamid: "wamid.42",
      firstContactAt: new Date("2026-09-03T12:00:00.000Z"),
    });
  });

  it("markFailed leva o lead a failed", async () => {
    const leads = repo();
    await leads.upsert({ phone: "+5511988887777" });

    await leads.markFailed("+5511988887777", new Date("2026-09-03T12:00:00.000Z"));

    expect((await leads.findByPhone("+5511988887777"))!.prospectingState).toBe("failed");
  });

  it("markReplied leva de sent para replied e registra replied_at", async () => {
    const leads = repo();
    await leads.upsert({ phone: "+5511988887777" });
    await leads.markProspected("+5511988887777", "wamid.1", new Date("2026-09-03T12:00:00.000Z"));

    await leads.markReplied("+5511988887777", new Date("2026-09-03T12:30:00.000Z"));

    const record = await leads.findByPhone("+5511988887777");
    expect(record).toMatchObject({
      prospectingState: "replied",
      repliedAt: new Date("2026-09-03T12:30:00.000Z"),
    });
  });

  it("markReplied é no-op fora do estado sent", async () => {
    const leads = repo();
    await leads.upsert({ phone: "+5511988887777" }); // pending

    await leads.markReplied("+5511988887777", new Date("2026-09-03T12:30:00.000Z"));

    const record = await leads.findByPhone("+5511988887777");
    expect(record!.prospectingState).toBe("pending");
    expect(record!.repliedAt).toBeNull();
  });
});
