import { describe, expect, it } from "vitest";
import { LeadSerialQueue } from "./lead-serial-queue.ts";

const PHONE_A = "+5511999999999";
const PHONE_B = "+5511888888888";

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("LeadSerialQueue", () => {
  it("executa tarefas do mesmo lead em ordem, uma de cada vez", async () => {
    const queue = new LeadSerialQueue();
    const events: string[] = [];
    const gate = deferred();

    const first = queue.run(PHONE_A, async () => {
      events.push("first:start");
      await gate.promise;
      events.push("first:end");
    });
    const second = queue.run(PHONE_A, async () => {
      events.push("second:start");
    });

    // A segunda tarefa não começa enquanto a primeira não termina.
    await Promise.resolve();
    expect(events).toEqual(["first:start"]);

    gate.resolve();
    await Promise.all([first, second]);

    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("tarefas de leads diferentes correm em paralelo", async () => {
    const queue = new LeadSerialQueue();
    const events: string[] = [];
    const gateA = deferred();

    const a = queue.run(PHONE_A, async () => {
      events.push("a:start");
      await gateA.promise;
      events.push("a:end");
    });
    const b = queue.run(PHONE_B, async () => {
      events.push("b:start");
    });

    await b;
    // B terminou antes de A ser liberada — não ficou preso atrás de A.
    expect(events).toEqual(["a:start", "b:start"]);

    gateA.resolve();
    await a;
    expect(events).toEqual(["a:start", "b:start", "a:end"]);
  });

  it("uma tarefa que rejeita não trava as seguintes do mesmo lead", async () => {
    const queue = new LeadSerialQueue();

    const failing = queue.run(PHONE_A, () => Promise.reject(new Error("boom")));
    await expect(failing).rejects.toThrow("boom");

    const after = await queue.run(PHONE_A, () => Promise.resolve("ok"));
    expect(after).toBe("ok");
  });

  it("run resolve com o retorno da tarefa", async () => {
    const queue = new LeadSerialQueue();

    await expect(queue.run(PHONE_A, () => Promise.resolve(42))).resolves.toBe(42);
  });

  it("whenSettled aguarda todas as filas", async () => {
    const queue = new LeadSerialQueue();
    const events: string[] = [];
    const gate = deferred();

    void queue.run(PHONE_A, async () => {
      await gate.promise;
      events.push("a:done");
    });
    void queue.run(PHONE_B, async () => {
      events.push("b:done");
    });

    gate.resolve();
    await queue.whenSettled();

    expect(events.sort()).toEqual(["a:done", "b:done"]);
  });
});
