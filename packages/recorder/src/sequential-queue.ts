/**
 * Chains async work so it runs strictly in submission order, even when
 * individual tasks resolve out of order (e.g. concurrent fs writes). The
 * proxy uses one of these per run to guarantee trajectory events are
 * appended in `seq` order and to know when every write has drained before
 * writing the run manifest at session end.
 */
export class SequentialQueue {
  private tail: Promise<void> = Promise.resolve();

  /** Enqueues `task`; resolves once `task` (and everything before it) has run. */
  push(task: () => Promise<void>): Promise<void> {
    this.tail = this.tail.then(task);
    return this.tail;
  }

  /** Resolves once every task enqueued so far has completed. */
  drain(): Promise<void> {
    return this.tail;
  }
}
