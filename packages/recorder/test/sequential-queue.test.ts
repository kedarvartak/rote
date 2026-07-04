import { describe, expect, it } from 'vitest';
import { SequentialQueue } from '../src/sequential-queue.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('SequentialQueue', () => {
  it('runs tasks in push order even when later tasks resolve faster', async () => {
    const queue = new SequentialQueue();
    const order: number[] = [];
    queue.push(async () => {
      await delay(20);
      order.push(1);
    });
    queue.push(async () => {
      await delay(0);
      order.push(2);
    });
    const third = queue.push(async () => {
      order.push(3);
    });
    await third;
    expect(order).toEqual([1, 2, 3]);
  });

  it('drain() resolves only after every enqueued task has completed', async () => {
    const queue = new SequentialQueue();
    let completed = 0;
    for (let i = 0; i < 5; i += 1) {
      queue.push(async () => {
        await delay(5);
        completed += 1;
      });
    }
    await queue.drain();
    expect(completed).toBe(5);
  });
});
