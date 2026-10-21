/** Ported from BDTS worker/src/lobby/drain.ts: one FIFO drain across asynchronous World calls. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(task: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
