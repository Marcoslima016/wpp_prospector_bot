import type { ConversationCategory } from "../../domain/whatsapp-conversation-billing.ts";

/**
 * Versão da tabela de preços de conversa da Meta — gravada em cada evento de
 * consumo (`whatsapp_conversation_events.price_version`) para rastreio/desempate.
 * Faça bump ao alterar `META_CONVERSATION_PRICES`.
 */
export const META_PRICE_TABLE_VERSION = "2026-09-02";

/** Preço de uma conversa da Meta, em US$, por categoria e país do destinatário. */
export interface MetaConversationPrice {
  category: ConversationCategory;
  /** ISO-3166-1 alpha-2 (maiúsculas), ex.: `"BR"`. */
  country: string;
  /** Data (YYYY-MM-DD) a partir da qual este preço vale. */
  effectiveFrom: string;
  /** US$ por janela de conversa de 24 h. `0` é válido (ex.: `service` gratuita). */
  usdPerConversation: number;
}

/**
 * Preços de conversa da Meta por categoria, para o país-base do MVP (`BR`). O
 * preço real varia por país do destinatário; enquanto o sistema não resolve o
 * país de cada lead, assume-se `WHATSAPP_BILLING_COUNTRY` (default `BR`).
 *
 * Valores em US$/conversa — **estimativa** a partir da rate card da Meta
 * (https://developers.facebook.com/docs/whatsapp/pricing). `service` = 0 desde
 * que a Meta deixou de cobrar service conversations. Revisar e fazer bump de
 * `META_PRICE_TABLE_VERSION` ao atualizar. Reconciliação com a fatura real é
 * non-goal desta capability.
 */
export const META_CONVERSATION_PRICES: readonly MetaConversationPrice[] = [
  { category: "marketing", country: "BR", effectiveFrom: "2025-07-01", usdPerConversation: 0.0625 },
  { category: "utility", country: "BR", effectiveFrom: "2025-07-01", usdPerConversation: 0.008 },
  {
    category: "authentication",
    country: "BR",
    effectiveFrom: "2025-07-01",
    usdPerConversation: 0.0315,
  },
  { category: "service", country: "BR", effectiveFrom: "2025-07-01", usdPerConversation: 0 },
];

/**
 * Preço vigente de `category`/`country` na data `onDate`: a entrada de maior
 * `effectiveFrom` que não passa de `onDate`. `undefined` quando a combinação não
 * está cadastrada (inclui `category: "unknown"`) — nesse caso o custo é
 * indisponível, mas a contagem de conversas segue agregável.
 */
export function priceFor(
  category: ConversationCategory | "unknown",
  country: string,
  onDate: Date,
): MetaConversationPrice | undefined {
  if (category === "unknown") {
    return undefined;
  }
  const wantedCountry = country.toUpperCase();
  const day = onDate.toISOString().slice(0, 10);

  return META_CONVERSATION_PRICES.filter(
    (price) =>
      price.category === category &&
      price.country === wantedCountry &&
      price.effectiveFrom <= day,
  ).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
}

/** Custo em US$ de `conversationCount` conversas segundo `price`. */
export function costOf(conversationCount: number, price: MetaConversationPrice): number {
  return conversationCount * price.usdPerConversation;
}
