import { describe, expect, it } from 'vitest';
import { evaluateBrowserExpect } from '@rote/action';
import type { CapturedElement, CapturedPage } from '@rote/browser';
import { distillPage, isElementVisible } from '@rote/perception';
import { BrowserToolCaller, type BrowserReplayPage } from '../../src/index.js';

// see CLAUDE.md sacred invariant 1 — "never silently wrong". Three layers ask
// "is this element visible?": observation (what the planner is shown),
// dispatch (what a replayed step may target and what it reports back), and
// verification (what decides a run succeeded). They had three implementations,
// and the one furthest from dispatch was the most permissive — so an element
// the dispatcher would not surface could still satisfy a text_visible check,
// and a merely translucent control was dropped by dispatch while observation
// kept it. Agreement is the invariant; this suite is what enforces it.

// A button: interactive, so observation keeps it whenever it is visible and
// drops it only for visibility — which is what this suite is comparing.
const el = (attributes: Record<string, string>, text: string, tag = 'button'): CapturedElement =>
  ({ tag, attributes, text, depth: 1 });

/** Every case on which the three copies used to disagree, plus controls. */
const CORPUS: ReadonlyArray<{ name: string; element: CapturedElement; visible: boolean }> = [
  { name: 'plain visible text', element: el({ id: 'a' }, 'Registration complete'), visible: true },
  { name: 'display:none', element: el({ id: 'a', style: 'display:none' }, 'Registration complete'), visible: false },
  { name: 'visibility:hidden', element: el({ id: 'a', style: 'visibility:hidden' }, 'Registration complete'), visible: false },
  { name: 'the hidden attribute', element: el({ id: 'a', hidden: '' }, 'Registration complete'), visible: false },
  { name: 'aria-hidden', element: el({ id: 'a', 'aria-hidden': 'true' }, 'Registration complete'), visible: false },
  // Verification's copy knew none of the three below.
  { name: 'opacity:0', element: el({ id: 'a', style: 'opacity:0' }, 'Registration complete'), visible: false },
  { name: 'the fixture escape hatch', element: el({ id: 'a', 'data-rote-visible': 'false' }, 'Registration complete'), visible: false },
  { name: 'a hidden input', element: el({ id: 'a', type: 'hidden', value: 'x' }, 'Registration complete', 'input'), visible: false },
  // ...and dispatch's copy dropped this one, which observation kept.
  { name: 'opacity:0.5 (translucent, still real)', element: el({ id: 'a', style: 'opacity:0.5' }, 'Registration complete'), visible: true },
];

const pageWith = (element: CapturedElement): CapturedPage => ({
  url: 'https://fixture.test/vendors',
  title: 'Vendor portal',
  html: '<main></main>',
  elements: [el({ id: 'anchor' }, 'Anchor'), element],
});

describe('invariant: observation, dispatch and verification agree on what is visible', () => {
  it.each(CORPUS)('$name', async ({ element, visible }) => {
    const page = pageWith(element);

    // 1. The rule itself.
    expect(isElementVisible(element)).toBe(visible);

    // 2. Verification — what decides a run succeeded.
    expect(evaluateBrowserExpect({ text_visible: 'Registration complete' }, page).pass).toBe(visible);
    expect(evaluateBrowserExpect({ selector_visible: '#a' }, page).pass).toBe(visible);
    expect(evaluateBrowserExpect({ selector_absent: '#a' }, page).pass).toBe(!visible);

    // 3. Observation — what the planner is shown.
    const observed = distillPage(page).some((node) => node.selectorHint === '#a' || node.name === 'Registration complete');
    expect(observed).toBe(visible);

    // 4. Dispatch — what a replayed step reports back for later assertions.
    const outcome = await new BrowserToolCaller(new FakePage(page)).call('browser.navigate', { url: page.url });
    const reported = (outcome as { result: { visible_selectors: string[]; visible_text: string[] } }).result;
    expect(reported.visible_selectors.includes('#a')).toBe(visible);
    expect(reported.visible_text.includes('Registration complete')).toBe(visible);
  });

  it('has a corpus that would fail against either of the implementations this replaced', () => {
    // A guard against the suite quietly becoming vacuous: it must contain at
    // least one case the old verification copy got wrong (opacity, the escape
    // hatch, a hidden input) and one the old dispatch copy got wrong (a
    // translucent control read as invisible by substring match).
    expect(CORPUS.filter((c) => !c.visible && /opacity:0$|data-rote-visible|type: 'hidden'|hidden input/.test(c.name)).length).toBeGreaterThan(0);
    expect(CORPUS.some((c) => c.visible && c.name.includes('translucent'))).toBe(true);
  });
});

class FakePage implements BrowserReplayPage {
  constructor(private readonly page: CapturedPage) {}
  async navigate(): Promise<void> {}
  async fill(): Promise<void> {}
  async select(): Promise<void> {}
  async click(): Promise<void> {}
  async capture(): Promise<CapturedPage> { return this.page; }
}
