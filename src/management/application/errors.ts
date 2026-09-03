/** Não existe conversa persistida para o telefone informado numa ação de operação. */
export class ConversationNotFoundError extends Error {
  constructor(readonly leadPhone: string) {
    super(`Conversa não encontrada para o lead ${leadPhone}`);
    this.name = "ConversationNotFoundError";
  }
}

/** A janela de atendimento de 24 h do lead está fechada — não dá para enviar mensagem de sessão. */
export class SessionWindowClosedError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "SessionWindowClosedError";
  }
}

/** O texto da mensagem avulsa do operador veio vazio. */
export class EmptyMessageTextError extends Error {
  constructor() {
    super("O texto da mensagem não pode ser vazio");
    this.name = "EmptyMessageTextError";
  }
}

/** O telefone informado no cadastro/disparo de lead não está no formato E.164. */
export class InvalidLeadPhoneError extends Error {
  constructor(readonly phone: string) {
    super(`Telefone inválido (esperado E.164): ${phone}`);
    this.name = "InvalidLeadPhoneError";
  }
}

/** Não existe lead cadastrado para o telefone informado no disparo de prospecção. */
export class LeadNotFoundError extends Error {
  constructor(readonly leadPhone: string) {
    super(`Lead não cadastrado para o telefone ${leadPhone}`);
    this.name = "LeadNotFoundError";
  }
}

/** Nenhum template de primeiro contato de prospecção está configurado. */
export class FirstContactTemplateNotConfiguredError extends Error {
  constructor() {
    super("Nenhum template de primeiro contato de prospecção está configurado");
    this.name = "FirstContactTemplateNotConfiguredError";
  }
}

/** O gateway do WhatsApp rejeitou o envio do template de primeiro contato. */
export class ProspectingGatewayError extends Error {
  constructor(
    readonly leadPhone: string,
    readonly reason: string,
    options?: { cause?: unknown },
  ) {
    super(`Falha ao enviar o primeiro contato de prospecção para ${leadPhone}: ${reason}`, {
      cause: options?.cause,
    });
    this.name = "ProspectingGatewayError";
  }
}
