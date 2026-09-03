import { describe, expect, it } from "vitest";
import { InMemoryLeadRepository } from "../test-support/in-memory-lead-repository.ts";
import { InvalidLeadPhoneError } from "./errors.ts";
import { RegisterLeadUseCase } from "./register-lead.use-case.ts";

function useCase(): { leads: InMemoryLeadRepository; register: RegisterLeadUseCase } {
  const leads = new InMemoryLeadRepository();
  return { leads, register: new RegisterLeadUseCase({ leads }) };
}

describe("RegisterLeadUseCase", () => {
  it("cadastra um lead novo em estado pending", async () => {
    const { register } = useCase();

    const record = await register.register({
      phone: "+5511988887777",
      displayName: "Ana",
      source: "ads",
    });

    expect(record).toMatchObject({
      phone: "+5511988887777",
      displayName: "Ana",
      source: "ads",
      prospectingState: "pending",
    });
  });

  it("re-cadastro do mesmo telefone não duplica e preserva o estado de prospecção", async () => {
    const { leads, register } = useCase();
    await register.register({ phone: "+5511988887777", displayName: "Ana" });
    await leads.markProspected("+5511988887777", "wamid.1", new Date());

    const updated = await register.register({ phone: "+5511988887777", notes: "retornar amanhã" });

    expect(updated.prospectingState).toBe("sent");
    expect(updated.displayName).toBe("Ana");
    expect(updated.notes).toBe("retornar amanhã");
  });

  it("rejeita telefone fora do formato E.164 sem persistir", async () => {
    const { leads, register } = useCase();

    await expect(register.register({ phone: "11988887777" })).rejects.toBeInstanceOf(
      InvalidLeadPhoneError,
    );
    expect(await leads.findByPhone("11988887777")).toBeNull();
  });
});
