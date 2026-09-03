import { describe, expect, it } from "vitest";
import { InMemoryLeadRepository } from "../test-support/in-memory-lead-repository.ts";
import { LeadBatchTooLargeError } from "./errors.ts";
import { ImportLeadsUseCase } from "./import-leads.use-case.ts";

function buildUseCase(maxRows?: number): {
  leads: InMemoryLeadRepository;
  useCase: ImportLeadsUseCase;
} {
  const leads = new InMemoryLeadRepository();
  const useCase = new ImportLeadsUseCase({ leads, maxRows });
  return { leads, useCase };
}

describe("ImportLeadsUseCase", () => {
  it("lote misto novos/existentes: cria os novos, sobrescreve os existentes e preserva o estado", async () => {
    const { leads, useCase } = buildUseCase();
    await leads.upsertFromImport({ phone: "+5516991178924", company: "Antiga" });
    await leads.markProspected("+5516991178924", "wamid.1", new Date());

    const result = await useCase.import({
      leads: [
        { phone: "(16) 99117-8924", company: "Nova" },
        { phone: "16997379471", company: "Fresh", segment: "obras" },
      ],
    });

    expect(result).toEqual({ imported: 1, updated: 1, rejected: [] });
    const existing = await leads.findByPhone("+5516991178924");
    expect(existing).toMatchObject({ company: "Nova", prospectingState: "sent" });
    const created = await leads.findByPhone("+5516997379471");
    expect(created).toMatchObject({ company: "Fresh", segment: "obras", prospectingState: "pending" });
  });

  it("linhas inválidas não abortam o lote e voltam em rejected com a linha de origem", async () => {
    const { useCase } = buildUseCase();

    const result = await useCase.import({
      leads: [
        { phone: "16991178924" },
        { phone: "" },
        { phone: "(16) 3913-4635" }, // fixo
        { phone: "16997379471" },
      ],
    });

    expect(result.imported).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.rejected).toEqual([
      { row: 1, phone: "", reason: "vazio" },
      { row: 2, phone: "(16) 3913-4635", reason: "fixo" },
    ]);
  });

  it("telefone repetido no lote colapsa: um único lead com a última ocorrência", async () => {
    const { leads, useCase } = buildUseCase();

    const result = await useCase.import({
      leads: [
        { phone: "16991178924", company: "Primeira", city: "A" },
        { phone: "(16) 99117-8924", company: "Última" },
      ],
    });

    expect(result.imported).toBe(1);
    const lead = await leads.findByPhone("+5516991178924");
    expect(lead).toMatchObject({ company: "Última" });
  });

  it("nada é disparado: sem conversa, sem template — só grava leads", async () => {
    const { leads, useCase } = buildUseCase();

    await useCase.import({ leads: [{ phone: "16991178924" }] });

    const lead = await leads.findByPhone("+5516991178924");
    expect(lead!.prospectingState).toBe("pending");
    expect(lead!.firstContactWamid).toBeNull();
  });

  it("lote acima do limite é rejeitado antes de gravar", async () => {
    const { leads, useCase } = buildUseCase(2);

    await expect(
      useCase.import({
        leads: [{ phone: "1" }, { phone: "2" }, { phone: "3" }],
      }),
    ).rejects.toBeInstanceOf(LeadBatchTooLargeError);
    expect(await leads.findByPhone("+551")).toBeNull();
  });
});
