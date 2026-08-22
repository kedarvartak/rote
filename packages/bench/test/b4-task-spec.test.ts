import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// see docs/03-benchmark.md B4 and T41 — the billed campaign runs tasks from the
// shared task file (fairness: both harnesses read one spec). B4's defining
// property is that the correct category is derivable only from the item body:
// the prompt must never contain the answer, and the oracle must be the
// fixture's exact confirmation.

describe('B4 task spec', () => {
  it('states the judgment task without leaking the category, against the fixture\'s exact oracle', async () => {
    const tasks = JSON.parse(await readFile(resolve('../../scripts/bench/headhead/tasks.json'), 'utf8'));
    const b4 = tasks.tasks.find((task: { id: string }) => task.id === 'B4');
    expect(b4).toBeDefined();
    expect(b4.path).toBe('b4-triage.html?item=TKT-1041');
    // The oracle is the fixture's exact confirmation for the correct category.
    expect(b4.verify_text).toBe('Item routed | item=TKT-1041 | category=billing');
    // The judgment gate's premise: the prompt names the item, never the answer.
    expect(b4.prompt).toContain('TKT-1041');
    expect(b4.prompt.toLowerCase()).not.toContain('billing');
    expect(b4.prompt.toLowerCase()).not.toContain('refund');
    expect(b4.prompt.toLowerCase()).not.toContain('invoice');

    // The fixture actually decides the answer: the deciding cue lives in the
    // item body, and the confirmation template matches the oracle string.
    const fixture = await readFile(resolve('../../fixtures/sites/b4-triage.html'), 'utf8');
    expect(fixture).toContain('charged twice');
    expect(fixture).toContain('refund of the duplicate payment');
    expect(fixture).toContain('Item routed | item=${requested} | category=${category}');
    expect(fixture).toContain('value="billing"');
  });
});
