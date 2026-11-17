export class OperationQueue {
  /**
   * Single queue for edits and saves: a change is never interleaved with a write
   * (saveTo clears dirty after an await) and anything that arrives during a save is applied afterwards.
   */
  private queue: Promise<unknown> = Promise.resolve();

  /** Waits for the queue to drain (pending edits and saves). */
  async idle(): Promise<void> {
    let q: Promise<unknown>;
    do {
      q = this.queue;
      await q;
    } while (q !== this.queue);
  }

  enqueue<T>(op: () => Promise<T>): Promise<T> {
    const p = this.queue.then(op);
    this.queue = p.catch(() => {});
    return p;
  }
}
