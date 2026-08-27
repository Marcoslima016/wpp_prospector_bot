export interface ReplySenderPort {
  /** Envia uma mensagem de texto ao lead. Deve tratar retry/erros internamente. */
  send(to: string, body: string): Promise<void>;
}
