import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileBrowserAgentRunRecorder, runBrowserAgent, type BrowserAction, type BrowserPageSession, type BrowserPlannerClient } from '@rote/agent';
import { captureStaticHtml, type CapturedPage } from '@rote/browser';
import { buildEnvFingerprint, parsePlaybookYaml, writePlaybookYaml } from '@rote/core';
import { BrowserToolCaller, runPlaybook, type BrowserReplayPage, type LlmClient } from '@rote/executor';
import { distillTrajectory, loadRecordedRun } from '../../src/index.js';

// see docs/05-roadmap.md P2 item 8 — "Gate: distilled playbooks replay the fixture
// suite with zero human edits." A zero-token scripted agent records the B2
// registration through the real loop; the distiller turns that trajectory into a
// playbook; the executor replays it — with zero LLM calls, no edits, contract-gated.

const URL = 'https://fixture.test/vendors/register';
const FORM_HTML = readFileSync(resolve('../../fixtures/sites/b2-vendor-form.html'), 'utf8');
// Full-form variants of the drift fixtures: same identities, one thing changed.
const RENAMED_HTML = FORM_HTML.replaceAll('id="company-name"', 'id="company-name-v2"').replaceAll('for="company-name"', 'for="company-name-v2"');
const DESTRUCTIVE_HTML = FORM_HTML.replace('<form id="registration-form">', '<form id="registration-form" method="post" action="/vendors/delete-all">');

const VALUES: Record<string, string> = {
  company_name: 'Acme Tools', contact_email: 'ops@example.com', tax_id: '84-1129930', address_line1: '18 Harbor Way',
  city: 'Portland', postal_code: '97209', country: 'US', phone: '503-555-0148',
};
const FIELDS: Array<[param: string, selector: string, name: string, kind: 'fill' | 'select']> = [
  ['company_name', '#company-name', 'Company name', 'fill'], ['contact_email', '#contact-email', 'Contact email', 'fill'],
  ['tax_id', '#tax-id', 'Tax ID', 'fill'], ['address_line1', '#address-line1', 'Address line 1', 'fill'],
  ['city', '#city', 'City', 'fill'], ['postal_code', '#postal-code', 'Postal code', 'fill'],
  ['country', '#country', 'Country', 'select'], ['phone', '#phone', 'Phone', 'fill'],
];
const COMPLETE = 'Vendor registration complete';

/** Stateful static B2 page usable by both the live loop and the replay executor. */
class StaticB2Page implements BrowserPageSession, BrowserReplayPage {
  values = new Map<string, string>();
  fills: string[] = [];
  clicks: string[] = [];
  submitted = false;
  constructor(private html: string, private readonly requiredForSubmit: string[] = FIELDS.map(([, selector]) => selector)) {}
  async navigate(): Promise<void> {}
  async capture(): Promise<CapturedPage> {
    if (this.submitted) {
      return captureStaticHtml(URL, `<!doctype html><html><head><title>Vendor Registration</title></head><body><main><section id="registration-confirmation" role="status"><h2>${COMPLETE}</h2></section></main></body></html>`);
    }
    const page = captureStaticHtml(URL, this.html);
    for (const element of page.elements) {
      const id = element.attributes['id'];
      const value = id ? this.values.get(`#${id}`) : undefined;
      if (value === undefined) continue;
      element.attributes['value'] = value;
      if (element.tag === 'select') {
        // Reflect a selected option the way the CDP decorator does.
        element.text = value;
      }
    }
    return page;
  }
  async fill(selector: string, value: string): Promise<void> { this.fills.push(selector); this.values.set(selector, value); }
  async select(selector: string, value: string): Promise<void> { this.values.set(selector, value); }
  async click(selector: string): Promise<void> {
    this.clicks.push(selector);
    if (this.requiredForSubmit.every((required) => this.values.get(required))) this.submitted = true;
  }
}

function scriptedPlanner(): BrowserPlannerClient {
  const actions: BrowserAction[] = [
    { kind: 'navigate', url: URL },
    ...FIELDS.map(([param, selector, name, kind]) => (kind === 'fill'
      ? { kind: 'fill' as const, selector, role: 'textbox', name, value: VALUES[param]! }
      : { kind: 'select' as const, selector, role: 'combobox', name, value: VALUES[param]! })),
    { kind: 'click', selector: '#registration-submit', role: 'button', name: 'Submit registration' },
    { kind: 'done', success: true, summary: 'registered' },
  ];
  let index = 0;
  return { async plan(source) { const action = actions[Math.min(index, actions.length - 1)]!; index += 1; return { action, usage: { source, input_tokens: 0, output_tokens: 0 } }; } };
}

class CountingLlm implements LlmClient {
  calls = 0;
  async complete(): Promise<never> { this.calls += 1; throw new Error('replay must not call an LLM'); }
}

let baseDir: string | undefined;
afterEach(async () => { if (baseDir) await rm(baseDir, { recursive: true, force: true }); baseDir = undefined; });

async function recordAndDistill() {
  baseDir = await mkdtemp(join(tmpdir(), 'rote-distill-'));
  const recorder = new FileBrowserAgentRunRecorder({
    task: 'Register Acme Tools as a vendor',
    envFingerprint: buildEnvFingerprint({ tool_inventory: [{ name: 'browser.click', schema_hash: 'v1' }], target_identity: 'fixture.test', surface_versions: {} }),
    baseDir,
    runId: 'b2-record',
  });
  const page = new StaticB2Page(FORM_HTML);
  const result = await runBrowserAgent({
    task: 'Register Acme Tools as a vendor',
    page,
    planner: scriptedPlanner(),
    verifier: { async verify(capture) { const ok = capture.html.includes(COMPLETE); return { success: ok, summary: ok ? 'complete' : 'incomplete' }; } },
    recorder,
    maxSteps: 15,
  });
  expect(result.success).toBe(true);
  const run = await loadRecordedRun(baseDir, 'b2-record');
  return distillTrajectory(run.events, {
    playbookName: 'b2-distilled',
    intentDescription: run.manifest.task_spec,
    envFingerprint: { domain: 'fixture.test', tool_prefixes: ['browser.'] },
    params: Object.entries(VALUES).map(([name, value]) => ({ name, type: 'string' as const, value })),
    verify: [{ text_visible: COMPLETE }],
  });
}

async function replay(playbookYaml: string, page: StaticB2Page) {
  const llm = new CountingLlm();
  const result = await runPlaybook(parsePlaybookYaml(playbookYaml), { ...VALUES }, {
    toolCaller: new BrowserToolCaller(page),
    llmClient: llm,
    envFingerprint: buildEnvFingerprint({ tool_inventory: [{ name: 'browser.click', schema_hash: 'v1' }], target_identity: 'fixture.test', surface_versions: {} }),
    taskSpec: 'Register Acme Tools as a vendor',
    baseDir: baseDir!,
  });
  expect(llm.calls).toBe(0);
  return result;
}

describe('distilled playbooks replay the fixture suite with zero human edits', () => {
  it('records B2 through the live loop, distills, and replays the untouched YAML to verified success', async () => {
    const report = await recordAndDistill();
    // Every element step carries identity v2 and the recorded action contract; no
    // typed value survives literally.
    expect(report.pruned).toEqual([{ seq: 10, reason: 'terminal_done' }]);
    expect(report.playbook.steps).toHaveLength(10);
    expect(report.contractedStepIds).toHaveLength(9);
    const yaml = writePlaybookYaml(report.playbook);
    for (const value of Object.values(VALUES)) expect(yaml).not.toContain(value);
    expect(report.playbook.params.map((param) => param.name).sort()).toEqual(Object.keys(VALUES).sort());

    const fresh = new StaticB2Page(FORM_HTML);
    const result = await replay(yaml, fresh);
    expect(result.outcome).toBe('success');
    expect(result.completedStepIds).toHaveLength(10);
    expect(fresh.submitted).toBe(true);
    expect([...fresh.values.entries()]).toEqual(FIELDS.map(([param, selector]) => [selector, VALUES[param]!]));
  });

  it('replays the distilled playbook through harmless selector drift and stops it before a contract change', async () => {
    const report = await recordAndDistill();
    const yaml = writePlaybookYaml(report.playbook);

    // Renamed selector: identity heals, contract equal → the fill dispatches to the new id and the run succeeds.
    const renamed = new StaticB2Page(RENAMED_HTML, ['#company-name-v2', ...FIELDS.slice(1).map(([, selector]) => selector)]);
    const drifted = await replay(yaml, renamed);
    expect(drifted.outcome).toBe('success');
    expect(drifted.repairedStepIds).toEqual(['fill_company_name']);
    expect(renamed.fills[0]).toBe('#company-name-v2');

    // Destructive variant: same-named submit became a POST purge → contract mismatch,
    // zero clicks, classified fallback, every prior fill reported as completed.
    const destructive = new StaticB2Page(DESTRUCTIVE_HTML);
    const stopped = await replay(yaml, destructive);
    expect(stopped.outcome).toBe('fallback');
    expect(stopped.failedStepId).toBe('click_submit_registration');
    expect(stopped.failureCode).toBe('BROWSER_CONTRACT_MISMATCH');
    expect(stopped.reason).toContain('navigation → mutating');
    expect(destructive.clicks).toEqual([]);
    expect(destructive.submitted).toBe(false);
    expect(stopped.completedStepIds).toHaveLength(9);
  });
});
