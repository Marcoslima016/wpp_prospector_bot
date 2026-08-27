import { describe, expect, it } from "vitest";
import { DomainValidationError } from "./errors.ts";
import { OutboundTextMessage } from "./outbound-text-message.ts";

describe("OutboundTextMessage", () => {
  it("cria o VO a partir de um input válido", () => {
    const message = OutboundTextMessage.create({
      to: "+5511999999999",
      body: "Olá, tudo bem?",
    });

    expect(message.to).toBe("+5511999999999");
    expect(message.body).toBe("Olá, tudo bem?");
  });

  it("rejeita corpo vazio com DomainValidationError", () => {
    expect(() => OutboundTextMessage.create({ to: "+5511999999999", body: "" })).toThrow(
      DomainValidationError,
    );
  });

  it("rejeita corpo com mais de 4096 caracteres com DomainValidationError", () => {
    expect(() =>
      OutboundTextMessage.create({ to: "+5511999999999", body: "a".repeat(4097) }),
    ).toThrow(DomainValidationError);
  });

  it("rejeita número de destino fora do formato E.164 com DomainValidationError", () => {
    expect(() => OutboundTextMessage.create({ to: "11999999999", body: "Olá" })).toThrow(
      DomainValidationError,
    );
  });
});
