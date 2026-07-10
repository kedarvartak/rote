import { describe, expect, it } from 'vitest';
import type { CapturedPage } from '@rote/browser';
import { runBrowserAgent, type BrowserAction, type BrowserPageSession, type BrowserPlannerClient, type BrowserPlannerRequest } from '../src/index.js';

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
        { tag: 'input', attributes: { id: 'company-name', name: 'company_name' }, text: '', depth: 1 },
        { tag: 'select', attributes: { id: 'country', name: 'country' }, text: 'US', depth: 1 },
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
    return { action };
  }
}

describe('runBrowserAgent', () => {
  it('feeds compact observations to the planner and applies browser actions', async () => {
    const page = new FakePage();
    const planner = new ScriptedPlanner([
      { kind: 'navigate', url: 'mem://vendor' },
      { kind: 'fill', selector: '#company-name', value: 'Acme Tools' },
      { kind: 'select', selector: '#country', value: 'US' },
      { kind: 'click', selector: '#registration-submit' },
      { kind: 'done', success: true, summary: 'submitted registration' },
    ]);

    const result = await runBrowserAgent({ task: 'Register Acme Tools as a vendor', page, planner, maxSteps: 8 });

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
  });

  it('fails closed when the planner exceeds the step budget', async () => {
    const planner = new ScriptedPlanner([
      { kind: 'click', selector: '#registration-submit' },
      { kind: 'click', selector: '#registration-submit' },
    ]);

    const result = await runBrowserAgent({ task: 'loop forever', page: new FakePage(), planner, maxSteps: 2 });

    expect(result).toEqual(expect.objectContaining({ success: false, summary: 'planner exceeded maxSteps=2' }));
  });
});
