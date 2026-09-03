/**
 * Fila serial por lead: garante que, para um mesmo telefone, no máximo uma
 * tarefa roda por vez, na ordem de chegada. Tarefas de leads diferentes correm
 * em paralelo. Uma tarefa que rejeita não impede as seguintes do mesmo lead.
 *
 * Compartilhada entre o processamento de mensagens recebidas
 * (`InboundBatchCoordinator`) e as ações de operação do painel de gestão, para
 * que uma ação nunca leia/mute/grave uma conversa em paralelo a uma geração de
 * resposta em andamento para o mesmo lead.
 */
export class LeadSerialQueue {
  /** Cauda da fila de cada lead: resolve quando a última tarefa enfileirada termina (sucesso ou falha). */
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(leadPhone: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(leadPhone) ?? Promise.resolve();
    const result = previous.then(() => task());

    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(leadPhone, tail);
    void tail.then(() => {
      if (this.tails.get(leadPhone) === tail) {
        this.tails.delete(leadPhone);
      }
    });

    return result;
  }

  /** Aguarda o esvaziamento das filas de todos os leads (auxiliar de teste/shutdown). */
  async whenSettled(): Promise<void> {
    await Promise.all([...this.tails.values()]);
  }
}
