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

  describe("upsertFromImport", () => {
    it("cria o lead novo em pending com os campos de contexto da planilha", async () => {
      const leads = repo(() => new Date("2026-09-03T10:00:00.000Z"));

      const outcome = await leads.upsertFromImport({
        phone: "+5516991178924",
        company: "Obras SA",
        segment: "construção",
        city: "Ribeirão Preto",
        displayName: "João",
      });

      expect(outcome.existed).toBe(false);
      expect(outcome.lead).toMatchObject({
        phone: "+5516991178924",
        company: "Obras SA",
        segment: "construção",
        city: "Ribeirão Preto",
        displayName: "João",
        prospectingState: "pending",
        importedAt: new Date("2026-09-03T10:00:00.000Z"),
      });
    });

    it("sobrescreve os campos presentes preservando o estado de prospecção e os campos ausentes", async () => {
      const leads = repo();
      await leads.upsertFromImport({ phone: "+5516991178924", company: "Antiga", city: "São Paulo" });
      await leads.markProspected("+5516991178924", "wamid.1", new Date("2026-09-03T10:00:00.000Z"));

      const outcome = await leads.upsertFromImport({ phone: "+5516991178924", company: "Nova" });

      expect(outcome.existed).toBe(true);
      expect(outcome.lead.company).toBe("Nova");
      expect(outcome.lead.city).toBe("São Paulo"); // ausente no 2º lote → não tocado
      expect(outcome.lead.prospectingState).toBe("sent");
      expect(outcome.lead.firstContactWamid).toBe("wamid.1");

      const count = db!.prepare("SELECT COUNT(*) AS n FROM leads").get() as { n: number };
      expect(count.n).toBe(1);
    });
  });

  describe("resetProspecting", () => {
    it("volta a pending e zera os carimbos de primeiro contato", async () => {
      const leads = repo();
      await leads.upsert({ phone: "+5511988887777" });
      await leads.markProspected("+5511988887777", "wamid.1", new Date("2026-09-03T12:00:00.000Z"));
      await leads.markReplied("+5511988887777", new Date("2026-09-03T12:30:00.000Z"));

      const changed = await leads.resetProspecting("+5511988887777");

      expect(changed).toBe(true);
      const record = await leads.findByPhone("+5511988887777");
      expect(record).toMatchObject({
        prospectingState: "pending",
        firstContactWamid: null,
        firstContactAt: null,
        repliedAt: null,
      });
    });

    it("telefone inexistente é no-op reportável (false)", async () => {
      const leads = repo();
      expect(await leads.resetProspecting("+5511900000000")).toBe(false);
    });
  });

  describe("query", () => {
    async function seedLeads(): Promise<void> {
      // Ordem de importação crescente no relógio → mais recente primeiro na listagem.
      let t = 0;
      const at = (): Date => new Date(2026, 8, 3, 10, t++);
      for (const [phone, segment] of [
        ["+5516990000001", "obras"],
        ["+5516990000002", "obras"],
        ["+5516990000003", "varejo"],
        ["+5511990000004", "obras"],
      ] as const) {
        await new SqliteLeadRepository(db!, fakeLogger(), at).upsertFromImport({ phone, segment });
      }
    }

    it("filtra por estado", async () => {
      const leads = repo();
      await seedLeads();
      await leads.markProspected("+5516990000001", "w", new Date());

      const page = await leads.query({ state: "sent", limit: 10 });
      expect(page.items.map((l) => l.phone)).toEqual(["+5516990000001"]);
    });

    it("filtra por segmento e por trecho de telefone combinados", async () => {
      const leads = repo();
      await seedLeads();

      const page = await leads.query({ segment: "obras", phoneContains: "5516", limit: 10 });
      expect(page.items.map((l) => l.phone).sort()).toEqual([
        "+5516990000001",
        "+5516990000002",
      ]);
    });

    it("ordena de forma estável e pagina pelo cursor", async () => {
      const leads = repo();
      await seedLeads();

      const first = await leads.query({ limit: 2 });
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();

      const second = await leads.query({ limit: 2, cursor: first.nextCursor! });
      const allPhones = [...first.items, ...second.items].map((l) => l.phone);
      expect(new Set(allPhones).size).toBe(4); // sem sobreposição entre páginas
      expect(second.nextCursor).toBeNull();
    });

    it("nenhum lead corresponde → página vazia sem erro", async () => {
      const leads = repo();
      await seedLeads();
      const page = await leads.query({ segment: "inexistente", limit: 10 });
      expect(page.items).toEqual([]);
      expect(page.nextCursor).toBeNull();
    });
  });
});
