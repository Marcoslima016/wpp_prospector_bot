/** Dados normalizados de uma mensagem inbound, em primitivos (sem VO de domínio). */
export interface InboundMessageDto {
  from: string;
  messageId: string;
  text: string;
  timestamp: Date;
}

/**
 * Processador downstream de mensagens inbound. Implementado fora deste slice
 * (pelo motor de conversas). O encaminhamento não deve bloquear a resposta 200.
 */
export interface InboundMessagePort {
  receive(message: InboundMessageDto): void;
}
