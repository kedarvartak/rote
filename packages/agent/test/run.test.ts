import { describe, expect, it } from 'vitest';
import type { CapturedPage } from '@rote/browser';
import { runBrowserAgent, type BrowserAction, type BrowserAgentVerifier, type BrowserPageSession, type BrowserPlannerClient, type BrowserPlannerRequest } from '../src/index.js';

class FakePage implements BrowserPageSession {
  url = 'mem://blank';
  values = new Map<string, string>();
  clicks: string[] = [];

  async navigate(url: string): Promise<void> {
    this.url = url;
  }

  async capture(): Promise<CapturedPage> {
    return {
      url: this.url,
      title: 'Fake Browser Page',
      html: '<form><input id="company-name" /><select id="country"><option>US</option></select><button id="registration-submit">Submit registration</button></form>',
      elements: [
        { tag: 'input', attributes: { id: 'company-name', name: 'company_name', value: this.values.get('#company-name') ?? '' }, text: '', depth: 1 },
        { tag: 'select', attributes: { id: 'country', name: 'country', value: this.values.get('#country') ?? 'US' }, text: 'US', depth: 1 },
        { tag: 'button', attributes: { id: 'registration-submit' }, text: 'Submit registration', depth: 1 },
      ],
    };
  }

  async fill(selector: string, value: string): Promise<void> {
    this.values.set(selector, value);
  }

  async select(selector: string, value: string): Promise<void> {
    this.values.set(selector, value);
  }

  async click(selector: string): Promise<void> {
    this.clicks.push(selector);
  }
}

class ScriptedPlanner implements BrowserPlannerClient {
  sources: string[] = [];
  requests: BrowserPlannerRequest[] = [];

  constructor(private readonly actions: BrowserAction[]) {}

  async plan(source: 'planner', request: BrowserPlannerRequest) {
    this.sources.push(source);
    this.requests.push(request);
    const action = this.actions.shift();
    if (!action) throw new Error('script exhausted');
    return { action, usage: { source, input_tokens: 10, output_tokens: 2 } };
  }
}

const passVerifier: BrowserAgentVerifier = {
  async verify(_page, _task, plannerSummary) {
    return { success: true, summary: plannerSummary };
  },
};

describe('runBrowserAgent', () => {
  it('feeds compact observations to the planner and applies browser actions', async () => {
    const page = new FakePage();
    const planner = new ScriptedPlanner([
      { kind: 'navigate', url: 'mem://vendor', expect: { url_contains: 'mem://vendor' } },
      { kind: 'fill', selector: '#company-name', value: 'Acme Tools', expect: { input_value: '#company-name', equals: 'Acme Tools' } },
      { kind: 'select', selector: '#country', value: 'US', expect: { input_value: '#country', equals: 'US' } },
      { kind: 'click', selector: '#registration-submit', expect: { selector_visible: '#registration-submit' } },
      { kind: 'done', success: true, summary: 'submitted registration' },
    ]);

    const result = await runBrowserAgent({ task: 'Register Acme Tools as a vendor', page, planner, verifier: passVerifier, maxSteps: 8 });

    expect(result.success).toBe(true);
    expect(result.summary).toBe('submitted registration');
    expect(page.url).toBe('mem://vendor');
    expect(page.values.get('#company-name')).toBe('Acme Tools');
    expect(page.values.get('#country')).toBe('US');
    expect(page.clicks).toEqual(['#registration-submit']);
    expect(planner.sources).toEqual(['planner', 'planner', 'planner', 'planner', 'planner']);
    expect(planner.requests[1]?.observation.text).toContain('#company-name');
    expect(planner.requests[1]?.observation.approxTokens).toBeGreaterThan(0);
    expect(planner.requests[1]?.context.volatileSuffix).not.toContain('<form>');
    expect(planner.requests[1]?.context.stablePrefix).toBe(planner.requests[0]?.context.stablePrefix);
    expect(result.tokenUsage).toHaveLength(5);
    expect(result.tokenUsage.every((usage) => usage.source === 'planner')).toBe(true);
  });

  it('sends a diff after an explicit over-budget bootstrap observation', async () => {
    const planner = new ScriptedPlanner([
      { kind: 'click', selector: '#registration-submit', expect: { selector_visible: '#registration-submit' } },
      { kind: 'done', success: true, summary: 'done' },
    ]);

    await runBrowserAgent({
      task: 'Submit',
      page: new FakePage(),
      planner,
      verifier: passVerifier,
      observationMaxChars: 80,
    });

    expect(planner.requests.map((request) => request.observation.mode)).toEqual(['bootstrap', 'diff']);
    expect(planner.requests[0]?.observation.text).toContain('#registration-submit');
    expect(planner.requests[0]?.observation.bootstrap?.budgetChars).toBe(80);
    expect(planner.requests[1]?.observation.text).toBe('(no observation changes)');
  });

  it('drops a malformed stable ID and resolves through role and name', async () => {
    const page = new FakePage();
    const malformedAction = {
      kind: 'click',
      selector: '#stale-submit',
      stableId: 'invented-too-long',
      role: 'button',
      name: 'Submit registration',
    } as unknown as BrowserAction;
    const planner = new ScriptedPlanner([
      malformedAction,
      { kind: 'done', success: true, summary: 'submitted' },
    ]);

    const result = await runBrowserAgent({ task: 'Submit', page, planner, verifier: passVerifier });

    expect(page.clicks).toEqual(['#registration-submit']);
    expect('stableId' in result.steps[0]!.action ? result.steps[0]!.action.stableId : undefined).toBeUndefined();
    expect(result.steps[0]?.classifications).toEqual(['dropped_malformed_stable_id']);
    expect(result.steps[0]?.resolution?.strategy).toBe('role-name');
  });

  it('resolves a stale selector through role and name before dispatch', async () => {
    const page = new FakePage();
    const planner = new ScriptedPlanner([
      {
        kind: 'click',
        selector: '#stale-submit',
        role: 'button',
        name: 'Submit registration',
        expect: { selector_visible: '#stale-submit' },
      },
      { kind: 'done', success: true, summary: 'submitted' },
    ]);

    const result = await runBrowserAgent({ task: 'Submit', page, planner, verifier: passVerifier });

    expect(page.clicks).toEqual(['#registration-submit']);
    expect(result.steps[0]?.resolution).toEqual(expect.objectContaining({
      selector: '#registration-submit',
      strategy: 'role-name',
    }));
  });

  it('repairs one unresolvable target before performing any action', async () => {
    const page = new FakePage();
    const planner = new ScriptedPlanner([
      { kind: 'click', selector: '#invented', role: 'button', name: 'Invented submit' },
      { kind: 'click', selector: '#registration-submit' },
      { kind: 'done', success: true, summary: 'submitted' },
    ]);

    const result = await runBrowserAgent({ task: 'Submit', page, planner, verifier: passVerifier });

    expect(page.clicks).toEqual(['#registration-submit']);
    expect(planner.sources).toEqual(['planner', 'repair', 'planner']);
    expect(planner.requests[1]?.context.volatileSuffix).toContain('was NOT performed');
    expect(result.steps[0]?.action).toEqual({ kind: 'click', selector: '#registration-submit' });
    expect(result.steps[0]?.usage.source).toBe('planner');
    expect(result.steps[0]?.repairUsage?.map((usage) => usage.source)).toEqual(['repair']);
  });

  it('rejects planner usage attributed to another source', async () => {
    const planner: BrowserPlannerClient = {
      async plan() {
        return {
          action: { kind: 'done', success: true, summary: 'wrongly tagged' },
          usage: { source: 'matcher', input_tokens: 1, output_tokens: 1 },
        };
      },
    };

    await expect(runBrowserAgent({ task: 'submit', page: new FakePage(), planner, verifier: passVerifier })).rejects.toThrow(
      'planner returned usage tagged matcher',
    );
  });

  it('fails closed when the planner exceeds the step budget', async () => {
    const planner = new ScriptedPlanner([
      { kind: 'click', selector: '#registration-submit', expect: { selector_visible: '#registration-submit' } },
      { kind: 'click', selector: '#registration-submit', expect: { selector_visible: '#registration-submit' } },
    ]);

    const result = await runBrowserAgent({ task: 'loop forever', page: new FakePage(), planner, verifier: passVerifier, maxSteps: 2 });

    expect(result).toEqual(expect.objectContaining({ success: false, summary: 'planner exceeded maxSteps=2' }));
  });
});
