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
    });

    expect(second.stablePrefix).toBe(first.stablePrefix);
    expect(second.volatileSuffix).not.toBe(first.volatileSuffix);
    expect(second.volatileSuffix).toContain('Compact observation (diff)');
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
