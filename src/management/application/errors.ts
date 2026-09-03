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
