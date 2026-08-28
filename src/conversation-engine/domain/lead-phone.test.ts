import { describe, expect, it } from "vitest";
import { toE164LeadPhone } from "./lead-phone.ts";

describe("toE164LeadPhone", () => {
  it("prefixa `+` em número só com dígitos (formato dos webhooks da Meta)", () => {
    expect(toE164LeadPhone("5516991166257")).toBe("+5516991166257");
  });

  it("é idempotente para número já em E.164", () => {
    expect(toE164LeadPhone("+5516991166257")).toBe("+5516991166257");
  });

  it("remove espaços, traços e parênteses", () => {
    expect(toE164LeadPhone("+55 (16) 99116-6257")).toBe("+5516991166257");
  });
});
