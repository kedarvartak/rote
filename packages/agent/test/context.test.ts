import { describe, expect, it } from 'vitest';
import { assemblePlannerContext } from '../src/index.js';

describe('assemblePlannerContext', () => {
  it('keeps the prefix byte-stable when per-step browser state changes', () => {
    const first = assemblePlannerContext({
      task: 'Register Acme as a vendor',
      page: { url: 'https://portal.test/start', title: 'Start' },
      observation: 'button "Continue" selector=#continue',
      observationMode: 'full',
      previousActions: [],
    });
    const second = assemblePlannerContext({
      task: 'Register Acme as a vendor',
      page: { url: 'https://portal.test/form', title: 'Vendor Form' },
      observation: 'textbox "Company" selector=#company',
      observationMode: 'diff',
      previousActions: [{ kind: 'click', selector: '#continue', expect: { selector_visible: '#continue' } }],
      stateSummary: '{"selector":"#row-1","checked":true}',
    });

    expect(second.stablePrefix).toBe(first.stablePrefix);
    expect(second.volatileSuffix).not.toBe(first.volatileSuffix);
    expect(second.volatileSuffix).toContain('Compact observation (diff)');
    expect(second.volatileSuffix).toContain('Current stateful controls:');
    expect(second.volatileSuffix).toContain('#row-1');
    expect(second.volatileSuffix.startsWith('Previous actions:\n')).toBe(true);
    expect(second.volatileSuffix.indexOf('{"kind":"click"')).toBeLessThan(second.volatileSuffix.indexOf('Current page:'));
  });

  it('keeps prior append-only actions ahead of changing page state', () => {
    const action = { kind: 'click', selector: '#row-1' } as const;
    const make = (run: number, previousActions: readonly typeof action[]) => assemblePlannerContext({
      task: 'Select rows',
      page: { url: `https://portal.test?run=${run}`, title: `Run ${run}` },
      observation: `observation ${run}`,
      observationMode: 'diff',
      previousActions,
    });
    const first = make(1, [action]);
    const second = make(2, [action, action]);
    const reusablePrefix = `Previous actions:\n${JSON.stringify(action)}\n`;

    expect(first.volatileSuffix.startsWith(reusablePrefix)).toBe(true);
    expect(second.volatileSuffix.startsWith(reusablePrefix)).toBe(true);
    expect(second.volatileSuffix.indexOf('?run=2')).toBeGreaterThan(second.volatileSuffix.lastIndexOf(JSON.stringify(action)));
  });

  it('marks evicted observation history in the volatile suffix without changing the cache prefix', () => {
    const current = assemblePlannerContext({
      task: 'Compare product prices',
      page: { url: 'https://catalog.test/b', title: 'Product B' },
      observation: 'Product B price: $9',
      observationMode: 'full',
      previousActions: [{ kind: 'navigate', url: 'https://catalog.test/b' }],
    });
    const evicted = assemblePlannerContext({
      task: 'Compare product prices',
      page: { url: 'https://catalog.test/b', title: 'Product B' },
      observation: 'Product B price: $9',
      observationMode: 'full',
      previousActions: [{ kind: 'navigate', url: 'https://catalog.test/b' }],
      observationHistoryEvicted: true,
    });

    expect(evicted.stablePrefix).toBe(current.stablePrefix);
    expect(current.volatileSuffix).not.toContain('Recall boundary:');
    expect(evicted.volatileSuffix).toContain('failureClassification="recall_unavailable"');
    expect(evicted.volatileSuffix).toContain('do not guess');
  });

  it('keeps the stable prefix fixed across an explicit compaction boundary', () => {
    const actions = Array.from({ length: 40 }, (_, index) => ({
      kind: 'click' as const,
      selector: `#step-${index}`,
    }));
    const before = assemblePlannerContext({
      task: 'Complete a long workflow',
      page: { url: 'https://portal.test', title: 'Portal' },
      observation: 'button "Continue" selector=#continue',
      observationMode: 'full',
      previousActions: actions.slice(0, 24),
    });
    const after = assemblePlannerContext({
      task: 'Complete a long workflow',
      page: { url: 'https://portal.test', title: 'Portal' },
      observation: 'button "Continue" selector=#continue',
      observationMode: 'full',
      previousActions: actions,
    });

    expect(after.stablePrefix).toBe(before.stablePrefix);
    expect(before.history.compaction).toBeUndefined();
    expect(after.history.compaction?.compactedActionCount).toBe(32);
    expect(after.history.visibleActions.length).toBeLessThanOrEqual(31);
    expect(after.volatileSuffix).toContain('Recall boundary:');
  });

  it('puts action definitions before volatile observations', () => {
    const context = assemblePlannerContext({
      task: 'Find Alpha',
      page: { url: 'https://catalog.test', title: 'Catalog' },
      observation: 'textbox "Search" selector=#query',
      observationMode: 'full',
      previousActions: [],
    });

    expect(context.stablePrefix).toContain('{"kind":"click"');
    expect(context.stablePrefix).not.toContain('#query');
    expect(context.volatileSuffix).toContain('#query');
  });

  it('renders a site brief in the stable prefix (cache-safe) and nothing at all when the brief is empty', () => {
    const base = { task: 'Register Acme as a vendor', page: { url: 'https://portal.test/start', title: 'Start' }, observation: 'x', observationMode: 'full' as const, previousActions: [] };
    const cold = assemblePlannerContext(base);
    const empty = assemblePlannerContext({ ...base, siteBrief: '' });
    // T3 (docs/03): a cold site pays nothing — byte-identical to no brief.
    expect(empty.stablePrefix).toBe(cold.stablePrefix);
    const briefed = assemblePlannerContext({ ...base, siteBrief: 'Site memory (advisory):\n- form on page abcd: textbox "Company name" [v2:aaaaaaaaaaaaaaaa]' });
    expect(briefed.stablePrefix).toContain('Site memory (advisory)');
    expect(briefed.stablePrefix).toContain('Use it as a hint only');
    expect(briefed.volatileSuffix).toBe(cold.volatileSuffix);
    // Same brief on a later step: prefix unchanged.
    const later = assemblePlannerContext({ ...base, siteBrief: 'Site memory (advisory):\n- form on page abcd: textbox "Company name" [v2:aaaaaaaaaaaaaaaa]', observation: 'y', observationMode: 'diff', previousActions: [{ kind: 'click', selector: '#c' }] });
    expect(later.stablePrefix).toBe(briefed.stablePrefix);
  });
});
