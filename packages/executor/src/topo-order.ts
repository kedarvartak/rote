import type { Step } from '@rote/core';

/**
 * Returns step ids in an order that respects every `depends_on` edge.
 * `PlaybookSchema` already rejects cyclic `depends_on` at parse time (see
 * docs/05-roadmap.md M0), so a `Playbook` reaching the executor is
 * guaranteed acyclic — this never throws for a validated playbook. Pure.
 * v1 executes sequentially even where steps could run in parallel; the
 * build plan doesn't ask for parallel dispatch, so this stays the simplest
 * thing that satisfies every dependency.
 */
export function topoOrder(steps: readonly Step[]): string[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const done = new Set<string>();
  const order: string[] = [];

  function visit(id: string): void {
    if (done.has(id)) return;
    const step = byId.get(id);
    if (!step) return; // dangling depends_on is a PlaybookSchema rejection, not this fn's concern
    for (const dep of step.depends_on) visit(dep);
    done.add(id);
    order.push(id);
  }

  for (const step of steps) visit(step.id);
  return order;
}
