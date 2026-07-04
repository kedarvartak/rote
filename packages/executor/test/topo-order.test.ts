import { describe, expect, it } from 'vitest';
import type { Step } from '@rote/core';
import { topoOrder } from '../src/topo-order.js';

function detStep(id: string, depends_on: string[] = []): Step {
  return { id, depends_on, kind: 'deterministic', tool: 'echo', args: {}, on_fail: 'fallback' };
}

describe('topoOrder', () => {
  it('preserves order for a linear chain', () => {
    const steps = [detStep('a'), detStep('b', ['a']), detStep('c', ['b'])];
    expect(topoOrder(steps)).toEqual(['a', 'b', 'c']);
  });

  it('orders a dependency before its dependent even when listed after it', () => {
    const steps = [detStep('b', ['a']), detStep('a')];
    const order = topoOrder(steps);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
  });

  it('keeps every step exactly once for a diamond dependency', () => {
    const steps = [detStep('a'), detStep('b', ['a']), detStep('c', ['a']), detStep('d', ['b', 'c'])];
    const order = topoOrder(steps);
    expect(order).toHaveLength(4);
    expect(order.indexOf('d')).toBe(3);
  });
});
