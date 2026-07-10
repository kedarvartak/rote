import { describe, expect, it } from 'vitest';
import { assemblePlannerContext } from '../src/index.js';

describe('assemblePlannerContext', () => {
  it('keeps the prefix byte-stable when per-step browser state changes', () => {
    const first = assemblePlannerContext({
      task: 'Register Acme as a vendor',
      page: { url: 'https://portal.test/start', title: 'Start' },
      observation: 'button "Continue" selector=#continue',
      previousActions: [],
    });
    const second = assemblePlannerContext({
      task: 'Register Acme as a vendor',
      page: { url: 'https://portal.test/form', title: 'Vendor Form' },
      observation: 'textbox "Company" selector=#company',
      previousActions: [{ kind: 'click', selector: '#continue' }],
    });

    expect(second.stablePrefix).toBe(first.stablePrefix);
    expect(second.volatileSuffix).not.toBe(first.volatileSuffix);
  });

  it('puts action definitions before volatile observations', () => {
    const context = assemblePlannerContext({
      task: 'Find Alpha',
      page: { url: 'https://catalog.test', title: 'Catalog' },
      observation: 'textbox "Search" selector=#query',
      previousActions: [],
    });

    expect(context.stablePrefix).toContain('{"kind":"click"');
    expect(context.stablePrefix).not.toContain('#query');
    expect(context.volatileSuffix).toContain('#query');
  });
});
