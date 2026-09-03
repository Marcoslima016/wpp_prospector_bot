import { E164_REGEX } from "./outbound-message.ts";

/** Motivo pelo qual um telefone bruto não pôde ser normalizado para E.164 BR. */
export type BrazilPhoneRejection = "vazio" | "curto" | "longo" | "fixo" | "invalido";

export type NormalizeBrazilPhoneResult =
  | { phone: string }
  | { rejected: BrazilPhoneRejection };

/**
 * Normaliza um telefone brasileiro bruto (com máscara, espaços, `+`, DDI opcional)
 * para o formato E.164 (`+55DDDNNNNNNNNN`). DDI Brasil (55) é fixo — não há
 * suporte a leads fora do Brasil.
 *
 * Regra (ver design D2):
 *  - remove tudo que não é dígito;
 *  - vazio → rejeitado `vazio`;
 *  - remove o DDI `55` quando presente (total de 12–13 dígitos começando por 55);
 *  - o número nacional restante deve ter 10 (DDD + 8, provável fixo) ou 11
 *    (DDD + 9 + 8, celular) dígitos:
 *      - 11 dígitos ⇒ celular ⇒ aceito como `+55` + nacional;
 *      - 10 dígitos ⇒ rejeitado `fixo`;
 *      - menos de 10 ⇒ rejeitado `curto`;
 *      - mais de 11 ⇒ rejeitado `longo`.
 *
 * A distinção celular/fixo é heurística por contagem de dígitos: um fixo com um
 * 9º dígito digitado a mais pode passar — a Meta rejeita no envio e o lead vai
 * para `failed`, visível na tela.
 */
export function normalizeBrazilPhone(raw: string | null | undefined): NormalizeBrazilPhoneResult {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 0) {
    return { rejected: "vazio" };
  }

  const national =
    digits.length >= 12 && digits.startsWith("55") ? digits.slice(2) : digits;

  if (national.length < 10) {
    return { rejected: "curto" };
  }
  if (national.length > 11) {
    return { rejected: "longo" };
  }
  if (national.length === 10) {
    return { rejected: "fixo" };
  }

  const e164 = `+55${national}`;
  if (!E164_REGEX.test(e164)) {
    return { rejected: "invalido" };
  }
  return { phone: e164 };
}
