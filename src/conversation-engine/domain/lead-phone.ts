/**
 * Normaliza o telefone do lead para o formato E.164 (`+` seguido só de dígitos).
 *
 * Os webhooks da Meta entregam o remetente como dígitos no formato internacional
 * sem o `+` (ex.: `5516991166257`); o envio de mensagens exige E.164 com `+`.
 * A identidade da `Conversation` é sempre a forma E.164.
 */
export function toE164LeadPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return `+${digits}`;
}
