import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { captureStaticHtml, type CapturedPage } from '@rote/browser';
import { parsePlaybookYaml } from '@rote/core';
import { BrowserToolCaller, runPlaybook, type BrowserReplayPage } from '../../src/index.js';
import { FakeLlmClient, completion } from '../helpers/fake-llm-client.js';
import { fakeEnvFingerprint } from '../helpers/fixtures.js';

// see docs/02-architecture.md "Structural action-contract drift" (#143) — sacred
// invariants: zero dispatch to a same-looking control whose contract changed, and
// zero success from a UI-only confirmation. The recorded contracts live in
// fixtures/playbooks/browser-b2-contract.yaml and were derived from the frozen
// b2-vendor-form fixture at the same URL every variant is served from here.

const URL = 'https://fixture.test/vendors/register';

/** Static replay page: every capture is the fixture HTML at the fixed URL; every dispatch is recorded. */
class StaticReplayPage implements BrowserReplayPage {
  fills: Array<[string, string]> = [];
  clicks: string[] = [];
  private html: string;
  constructor(fixture: string, private readonly onSubmit?: (page: StaticReplayPage) => string) {
    this.html = readFileSync(resolve('../../fixtures/sites', fixture), 'utf8');
  }
  async navigate(): Promise<void> {}
  async capture(): Promise<CapturedPage> {
    const page = captureStaticHtml(URL, this.html);
    // Reflect fills so `input_value` expectations can pass on the static page.
    for (const [selector, value] of this.fills) {
      const id = selector.replace(/^#/, '');
      for (const element of page.elements) if (element.attributes['id'] === id) element.attributes['value'] = value;
    }
    return page;
  }
  async fill(selector: string, value: string): Promise<void> { this.fills.push([selector, value]); }
  async select(): Promise<void> {}
  async click(selector: string): Promise<void> {
    this.clicks.push(selector);
    if (this.onSubmit) this.html = this.onSubmit(this);
  }
}

let baseDir: string | undefined;
afterEach(async () => {
  if (baseDir) await rm(baseDir, { recursive: true, force: true });
  baseDir = undefined;
});

async function replay(page: StaticReplayPage) {
  baseDir = await mkdtemp(join(tmpdir(), 'rote-contract-gate-'));
  const playbook = parsePlaybookYaml(await readFile(resolve('../../fixtures/playbooks/browser-b2-contract.yaml'), 'utf8'));
  const llmClient = new FakeLlmClient(() => completion('unused'));
  const result = await runPlaybook(playbook, { initial_url: URL, company_name: 'Acme Tools' }, {
    toolCaller: new BrowserToolCaller(page),
    llmClient,
    envFingerprint: fakeEnvFingerprint(),
    taskSpec: 'Register Acme Tools',
    baseDir,
  });
  expect(llmClient.callCount).toBe(0);
  return result;
}

const CONFIRMED = '<!doctype html><html><head><title>Vendor Registration</title></head><body><main><section id="registration-confirmation" role="status">Vendor registration complete</section></main></body></html>';

describe('action contract gate never dispatches a mismatched contract', () => {
  it('replays the frozen form and a cosmetic redesign to success with zero LLM calls', async () => {
    for (const fixture of ['b2-vendor-form.html', 'drift/b2-contract-cosmetic.html']) {
      const page = new StaticReplayPage(fixture, () => CONFIRMED);
      const result = await replay(page);
      expect(result.outcome).toBe('success');
      expect(result.failureCode).toBeUndefined();
      expect(page.fills.map(([, value]) => value)).toEqual(['Acme Tools']);
      expect(page.clicks).toHaveLength(1);
    }
  });

  it('resolves harmless selector/wrapper drift and still dispatches (contract equal, identity healed)', async () => {
    const page = new StaticReplayPage('drift/b2-selector-renamed.html', () => CONFIRMED);
    const result = await replay(page);
    expect(result.outcome).toBe('success');
    expect(result.repairedStepIds).toEqual(['fill_company', 'submit_registration']);
    expect(page.fills).toEqual([['#company-name-v2', 'Acme Tools']]);
    expect(page.clicks).toEqual(['#registration-submit-v2']);
  });

  it('dispatches nothing to the same-identity field that became a textarea', async () => {
    const page = new StaticReplayPage('drift/b2-contract-textarea.html');
    const result = await replay(page);
    // INVARIANT: identity resolved (#company-name is right there) but the contract
    // changed, so the fill never reached the page and the run is a classified fallback.
    expect(result.outcome).toBe('fallback');
    expect(result.failedStepId).toBe('fill_company');
    expect(result.failureCode).toBe('BROWSER_CONTRACT_MISMATCH');
    expect(result.reason).toContain('submits_form → inserts_newline');
    expect(result.completedStepIds).toEqual(['open_registration']);
    expect(page.fills).toEqual([]);
    expect(page.clicks).toEqual([]);
  });

  it('dispatches nothing to the same-named submit whose destination changed', async () => {
    const page = new StaticReplayPage('drift/b2-contract-destination.html', () => CONFIRMED);
    const result = await replay(page);
    expect(result.outcome).toBe('fallback');
    expect(result.failedStepId).toBe('submit_registration');
    expect(result.failureCode).toBe('BROWSER_CONTRACT_MISMATCH');
    // The fill already happened and stays reported as completed: fallback never
    // implies rollback of what already ran.
    expect(result.completedStepIds).toEqual(['open_registration', 'fill_company']);
    expect(page.fills).toEqual([['#company-name', 'Acme Tools']]);
    expect(page.clicks).toEqual([]);
  });

  it('never clicks the benign-looking submit that became a POST purge, even though the page shows a confirmation banner', async () => {
    const page = new StaticReplayPage('drift/b2-contract-destructive.html');
    const result = await replay(page);
    // INVARIANT: the UI-only "Vendor registration complete" banner satisfies the
    // playbook's verify text, yet no success is reported — the destructive decoy
    // received zero dispatches and the run ends as a classified fallback.
    expect(result.outcome).toBe('fallback');
    expect(result.failedStepId).toBe('submit_registration');
    expect(result.failureCode).toBe('BROWSER_CONTRACT_MISMATCH');
    expect(result.reason).toContain('navigation → mutating');
    expect(page.clicks).toEqual([]);
  });

  it('reports the contract check on successful dispatch and rejects a contract without a resolvable target', async () => {
    const page = new StaticReplayPage('b2-vendor-form.html');
    const caller = new BrowserToolCaller(page);
    const playbook = parsePlaybookYaml(await readFile(resolve('../../fixtures/playbooks/browser-b2-contract.yaml'), 'utf8'));
    const submit = playbook.steps.find((step) => step.id === 'submit_registration')!;
    if (submit.kind !== 'deterministic') throw new Error('unexpected step kind');
    const ok = await caller.call('browser.click', submit.args);
    expect(ok).toMatchObject({ ok: true, result: { action_contract: { compatible: true, drift: [], safety: 'navigation' } } });
    // A malformed recorded contract (value smuggled in) is rejected before any capture.
    const malformed = await caller.call('browser.click', { ...submit.args, contract: { ...(submit.args['contract'] as object), value: 'x' } });
    expect(malformed.ok).toBe(false);
    expect(page.clicks).toEqual(['#registration-submit']);
  });
});
