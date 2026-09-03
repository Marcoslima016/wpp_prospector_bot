import { describe, expect, it } from "vitest";
import { normalizeBrazilPhone } from "./brazil-phone.ts";

describe("normalizeBrazilPhone", () => {
  it("celular com máscara e sem DDI → E.164 com DDI 55", () => {
    expect(normalizeBrazilPhone("(16) 99117-8924")).toEqual({ phone: "+5516991178924" });
  });

  it("celular só com dígitos e sem DDI → E.164 com DDI 55", () => {
    expect(normalizeBrazilPhone("16997379471")).toEqual({ phone: "+5516997379471" });
  });

  it("telefone fixo (10 dígitos nacionais) → rejeitado como fixo", () => {
    expect(normalizeBrazilPhone("(16) 3913-4635")).toEqual({ rejected: "fixo" });
  });

  it("vazio → rejeitado como vazio", () => {
    expect(normalizeBrazilPhone("")).toEqual({ rejected: "vazio" });
    expect(normalizeBrazilPhone("   ")).toEqual({ rejected: "vazio" });
    expect(normalizeBrazilPhone(null)).toEqual({ rejected: "vazio" });
    expect(normalizeBrazilPhone(undefined)).toEqual({ rejected: "vazio" });
  });

  it("dígitos a mais → rejeitado como longo", () => {
    expect(normalizeBrazilPhone("169974010035")).toEqual({ rejected: "longo" });
  });

  it("poucos dígitos → rejeitado como curto", () => {
    expect(normalizeBrazilPhone("99117-8924")).toEqual({ rejected: "curto" });
  });

  it("já em +55… válido passa inalterado", () => {
    expect(normalizeBrazilPhone("+5516991178924")).toEqual({ phone: "+5516991178924" });
  });

  it("com DDI 55 e máscara → normaliza para E.164", () => {
    expect(normalizeBrazilPhone("55 (16) 99117-8924")).toEqual({ phone: "+5516991178924" });
  });
});
