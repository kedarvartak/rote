import { describe, expect, it } from 'vitest';
import { ElementResolutionStaleIdentityError } from '@rote/action';
import type { CapturedElement, CapturedPage } from '@rote/browser';
import { distillPage, stableNodeRef } from '@rote/perception';
import { runBrowserAgent, type BrowserAction, type BrowserPageSession, type BrowserPlannerClient, type BrowserPlannerRequest } from '../../src/index.js';

// see docs/05-roadmap.md P2 item 7 (#132) — "route epochs, remounts,
// virtualization ... do not dispatch to stale identities" and "route/document
// epochs are modelled without treating every transition as a full navigation".
// Fake SPA: each click pushes a route, remounts the advance button with a new
// name, and keeps the same document token. Fifteen filler rows push the full
// snapshot over the observation budget so the diff path is actually exercised.

const DOC = 'a1a1a1a1a1a1a1a1';

function spaElements(transition: number): CapturedElement[] {
  return [
    { tag: 'p', attributes: { id: 'route' }, text: `/workflow/${transition}`, depth: 1 },
    { tag: 'button', attributes: { id: `advance-${transition + 1}` }, text: `Advance transition ${transition + 1}`, depth: 1 },
    ...Array.from({ length: 15 }, (_, index) => ({
      tag: 'a', attributes: { id: `row-${index}`, href: `/rows/${index}` }, text: `Virtualized workflow row ${index} with a stable long label`, depth: 2,
    })),
  ];
}

/** Fake single-document SPA; `documentToken` stays fixed while the URL and controls change per click. */
function spaPage(options: { documentToken?: string | ((transition: number) => string); onClick?: (selector: string) => void } = {}) {
  let transition = 0;
  const clicks: string[] = [];
  const page: BrowserPageSession & { clicks: string[] } = {
    clicks,
    async navigate() {},
    async capture(): Promise<CapturedPage> {
      const token = typeof options.documentToken === 'function' ? options.documentToken(transition) : options.documentToken;
      return {
        url: `https://spa.test/workflow/${transition}`,
        title: 'SPA',
        html: '',
        elements: spaElements(transition),
        ...(token ? { documentToken: token } : {}),
      };
    },
    async fill() {},
    async select() {},
    async click(selector) {
      clicks.push(selector);
      options.onClick?.(selector);
      transition += 1;
    },
  };
  return page;
}

function groundedAdvance(request: BrowserPlannerRequest, wanted: number): BrowserAction {
  const match = new RegExp(`\\* \\[(v2:[0-9a-f]{16})\\] button (\\S+) "Advance transition ${wanted}"$`, 'm').exec(request.observation.text);
  if (!match) throw new Error(`observation does not show Advance transition ${wanted}:\n${request.observation.text}`);
  return { kind: 'click', selector: match[2]!, stableId: match[1]!, role: 'button', name: `Advance transition ${wanted}` };
}

function advancingPlanner(transitions: number, mutate?: (request: BrowserPlannerRequest, source: string, action: BrowserAction) => BrowserAction): BrowserPlannerClient {
  return {
    async plan(source, request) {
      const usage = { source, input_tokens: 1, output_tokens: 1 };
      const completed = Number(/\/workflow\/(\d+)$/.exec(request.page.url)?.[1] ?? 0);
      if (completed >= transitions) return { action: { kind: 'done', success: true, summary: 'done' }, usage };
      const action = groundedAdvance(request, completed + 1);
      return { action: mutate ? mutate(request, source, action) : action, usage };
    },
  };
}

const passingVerifier = { async verify() { return { success: true, summary: 'verified' }; } };

describe('SPA endurance fails closed', () => {
  it('renders same-document route changes as diffs against the retained base and records the epoch relation', async () => {
    const result = await runBrowserAgent({
      task: 'Advance 6 transitions',
      page: spaPage({ documentToken: DOC }),
      planner: advancingPlanner(6),
      verifier: passingVerifier,
      observationMaxChars: 900,
      maxSteps: 10,
    });
    expect(result.success).toBe(true);
    const clicks = result.steps.filter((step) => step.action.kind === 'click');
    expect(clicks).toHaveLength(6);
    // Step 0 pays the explicit bootstrap base; every later transition is a diff.
    expect(clicks[0]!.observation.mode).toBe('bootstrap');
    expect(clicks.slice(1).map((step) => step.observation.mode)).toEqual(Array(5).fill('diff'));
    expect(clicks[0]!.pageTransition).toBeUndefined();
    expect(clicks.slice(1).map((step) => step.pageTransition)).toEqual(Array(5).fill({ routeChanged: true, documentChanged: false }));
  });

  it('resets the diff base when the document token changes even though the URL pattern is the same', async () => {
    const result = await runBrowserAgent({
      task: 'Advance 3 transitions',
      page: spaPage({ documentToken: (transition) => (transition < 2 ? DOC : 'b2b2b2b2b2b2b2b2') }),
      planner: advancingPlanner(3),
      verifier: passingVerifier,
      observationMaxChars: 900,
      maxSteps: 10,
    });
    const clicks = result.steps.filter((step) => step.action.kind === 'click');
    expect(clicks.map((step) => step.observation.mode)).toEqual(['bootstrap', 'diff', 'bootstrap']);
    expect(clicks[2]!.pageTransition).toEqual({ routeChanged: true, documentChanged: true });
  });

  it('treats a URL change as a document change when the backend reports no document token', async () => {
    const result = await runBrowserAgent({
      task: 'Advance 2 transitions',
      page: spaPage(),
      planner: advancingPlanner(2),
      verifier: passingVerifier,
      observationMaxChars: 900,
      maxSteps: 10,
    });
    const clicks = result.steps.filter((step) => step.action.kind === 'click');
    expect(clicks.map((step) => step.observation.mode)).toEqual(['bootstrap', 'bootstrap']);
    expect(clicks[1]!.pageTransition).toEqual({ routeChanged: true, documentChanged: true });
  });

  it('refuses to rebind an already-dispatched identity onto its remounted look-alike and repairs once without dispatching', async () => {
    // At step 2 the planner replays step 1's action verbatim (stableId + name of
    // "Advance transition 2", which the remount removed). Text proximity would
    // heal it onto "Advance transition 3"; that is a dispatch nobody chose.
    let repairs = 0;
    const page = spaPage({ documentToken: DOC });
    const result = await runBrowserAgent({
      task: 'Advance 4 transitions',
      page,
      planner: advancingPlanner(4, (request, source, action) => {
        if (source === 'repair') { repairs += 1; return action; }
        if (request.step === 2) {
          const previous = [...request.previousActions].reverse().find((entry) => entry.kind === 'click');
          if (!previous) throw new Error('no prior click');
          return previous;
        }
        return action;
      }),
      verifier: passingVerifier,
      observationMaxChars: 900,
      maxSteps: 10,
    });
    expect(result.success).toBe(true);
    expect(repairs).toBe(1);
    // INVARIANT: exactly one dispatch per transition — the stale replay never reached the page.
    expect(page.clicks).toEqual(['#advance-1', '#advance-2', '#advance-3', '#advance-4']);
    // The repair copied the fresh identity from the current observation.
    expect(result.steps[2]!.resolution?.strategy).toBe('stable-id');
    expect(result.steps[2]!.repairUsage).toHaveLength(1);
  });

  it('is fatal when the stale replay cannot be repaired', async () => {
    const page = spaPage({ documentToken: DOC });
    await expect(runBrowserAgent({
      task: 'Advance 4 transitions',
      page,
      planner: advancingPlanner(4, (request, _source, action) => {
        if (request.step === 2) return [...request.previousActions].reverse().find((entry) => entry.kind === 'click')!;
        return action;
      }),
      verifier: passingVerifier,
      observationMaxChars: 900,
      maxSteps: 10,
      maxTargetRepairs: 0,
    })).rejects.toBeInstanceOf(ElementResolutionStaleIdentityError);
    expect(page.clicks).toEqual(['#advance-1', '#advance-2']);
  });

  it('still lets a persistent control be re-clicked and a renamed never-dispatched control heal by text', async () => {
    // Same identity, still present → stable-id resolution, allowed. This pins
    // that the stale rule is about *gone* identities, not repeated actions.
    const nodes = distillPage({ url: 'https://spa.test/x', title: '', html: '', elements: [
      { tag: 'button', attributes: { id: 'next' }, text: 'Next page', depth: 1 },
    ] });
    const next = nodes.find((node) => node.selectorHint === '#next')!;
    let clicks = 0;
    const page: BrowserPageSession = {
      async navigate() {},
      async capture() { return { url: 'https://spa.test/x', title: '', html: '', elements: [{ tag: 'button', attributes: { id: 'next' }, text: 'Next page', depth: 1 }], documentToken: DOC }; },
      async fill() {}, async select() {},
      async click() { clicks += 1; },
    };
    const action: BrowserAction = { kind: 'click', selector: '#next', stableId: stableNodeRef(next.id), role: 'button', name: 'Next page' };
    let calls = 0;
    const result = await runBrowserAgent({
      task: 'Click next twice',
      page,
      planner: { async plan(source) { calls += 1; return { action: calls <= 2 ? action : { kind: 'done', success: true, summary: 'ok' }, usage: { source, input_tokens: 1, output_tokens: 1 } }; } },
      verifier: passingVerifier,
      maxSteps: 5,
    });
    expect(result.success).toBe(true);
    expect(clicks).toBe(2);
    expect(result.steps.map((step) => step.resolution?.strategy)).toEqual(['stable-id', 'stable-id', undefined]);
  });
});
