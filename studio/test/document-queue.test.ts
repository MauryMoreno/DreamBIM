import { describe, expect, it } from 'vitest';
import { OperationQueue } from '../src/document/queue';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('OperationQueue', () => {
  it('runs operations in order even when the first is slower', async () => {
    const queue = new OperationQueue();
    const order: string[] = [];
    const first = queue.enqueue(async () => {
      await sleep(20);
      order.push('first');
    });
    const second = queue.enqueue(async () => {
      order.push('second');
    });
    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second']);
  });

  it('idle waits for operations enqueued while it was waiting', async () => {
    const queue = new OperationQueue();
    const done: string[] = [];
    void queue.enqueue(async () => {
      await sleep(10);
      void queue.enqueue(async () => {
        await sleep(10);
        done.push('late');
      });
      done.push('early');
    });
    await queue.idle();
    expect(done).toEqual(['early', 'late']);
  });

  it('a rejected operation does not block the next one', async () => {
    const queue = new OperationQueue();
    const failing = queue.enqueue(async () => {
      throw new Error('boom');
    });
    await expect(failing).rejects.toThrow('boom');
    await expect(queue.enqueue(async () => 'still works')).resolves.toBe('still works');
  });
});
