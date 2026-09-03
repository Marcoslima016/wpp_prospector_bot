/** Categorias de conversa faturáveis da WhatsApp Cloud API. */
export type ConversationCategory = "marketing" | "utility" | "service" | "authentication";

const KNOWN_CATEGORIES: readonly ConversationCategory[] = [
  "marketing",
  "utility",
  "service",
  "authentication",
];

/** Forma tolerante do objeto `pricing` de um evento de status do webhook. */
export interface WebhookPricingData {
  billable?: boolean;
  pricing_model?: string;
  category?: string;
}

/** Forma tolerante do objeto `conversation` de um evento de status do webhook. */
export interface WebhookConversationData {
  id?: string;
  origin?: { type?: string };
  expiration_timestamp?: string;
}

/**
 * Dados de faturamento de uma janela de conversa de 24 h da Meta, extraídos dos
 * campos `pricing`/`conversation` de um evento de status. É a atribuição que a
 * capability `consumption-metrics` registra para estimar o custo de mensageria.
 *
 * Não confundir com `MessageStatusUpdate` (status de entrega de uma mensagem):
 * são responsabilidades distintas do mesmo evento de webhook.
 */
export class WhatsappConversationBilling {
  private constructor(
    /** Id da janela de 24 h — chave de deduplicação. */
    readonly conversationId: string,
    /** Categoria da conversa; `"unknown"` quando a Meta não informa ou manda um valor novo. */
    readonly category: ConversationCategory | "unknown",
    /** Tipo de origem da conversa (`conversation.origin.type`); `""` quando ausente. */
    readonly originType: string,
    /** Modelo de precificação informado pela Meta (`pricing.pricing_model`); `""` quando ausente. */
    readonly pricingModel: string,
    /** `true` só quando a Meta marca a janela como faturável. */
    readonly billable: boolean,
    /** Fim da janela de 24 h, quando a Meta informa. */
    readonly expirationTimestamp?: Date,
  ) {}

  /**
   * Deriva o VO dos objetos (já parseados, tolerantes) `pricing`/`conversation`
   * de um evento de status. Retorna `null` quando não há `conversation.id` — sem
   * chave de dedup não há janela para registrar. Os demais campos recebem
   * defaults tolerantes; nada aqui lança.
   */
  static fromWebhook(
    pricing?: WebhookPricingData,
    conversation?: WebhookConversationData,
  ): WhatsappConversationBilling | null {
    const conversationId = conversation?.id?.trim();
    if (!conversationId) {
      return null;
    }

    const rawCategory = pricing?.category?.trim().toLowerCase();
    const category = KNOWN_CATEGORIES.includes(rawCategory as ConversationCategory)
      ? (rawCategory as ConversationCategory)
      : "unknown";

    const expiration = parseUnixSeconds(conversation?.expiration_timestamp);

    return new WhatsappConversationBilling(
      conversationId,
      category,
      conversation?.origin?.type?.trim() ?? "",
      pricing?.pricing_model?.trim() ?? "",
      pricing?.billable === true,
      expiration,
    );
  }
}

/** `"1700086400"` (epoch em segundos, como a Meta manda) → `Date`. Entrada inválida → `undefined`. */
function parseUnixSeconds(value?: string): Date | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) {
    return undefined;
  }
  return new Date(seconds * 1000);
}
