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
});
