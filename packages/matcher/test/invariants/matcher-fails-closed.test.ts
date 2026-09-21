import { readFileSync } from 'node:fs';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileBrowserAgentRunRecorder, runBrowserAgent, type BrowserAction, type BrowserPageSession, type BrowserPlannerClient } from '@rote/agent';
import { captureStaticHtml, type CapturedPage } from '@rote/browser';
import { buildEnvFingerprint, type EnvFingerprint } from '@rote/core';
import { distillTrajectory, loadRecordedRun } from '@rote/distiller';
import { BrowserToolCaller, runPlaybook, type BrowserReplayPage, type LlmClient } from '@rote/executor';
import { FilePlaybookLibrary, matchPlaybook, playbookLibraryIndexPath, PlaybookVersionExistsError } from '../../src/index.js';

// see docs/02-architecture.md "Matcher" and docs/03-benchmark.md T0/T4 — sacred
// invariants for the tier-1 selection path: a learned playbook is selected for a
// same-shape task with new params and replays with zero model calls (T0); a
// near-miss task on the same site is never selected (T4: any false replay is a
// design kill); a playbook proved on another environment is discarded before any
// semantic comparison; and the library is append-only.

const URL = 'https://fixture.test/vendors/register';
const FORM_HTML = readFileSync(resolve('../../fixtures/sites/b2-vendor-form.html'), 'utf8');
const COMPLETE = 'Vendor registration complete';
const RECORD_VALUES: Record<string, string> = {
  company_name: 'Acme Tools', contact_email: 'ops@example.com', tax_id: '84-1129930', address_line1: '18 Harbor Way',
  city: 'Portland', postal_code: '97209', country: 'US', phone: '503-555-0148',
};
const NEW_VALUES: Record<string, string> = {
  company_name: 'Blue Fern Supply', contact_email: 'hello@bluefern.example', tax_id: '11-2233445', address_line1: '9 Quay Street',
  city: 'Bristol', postal_code: 'BS1 4DJ', country: 'US', phone: '0117 555 0100',
};
const FIELDS: Array<[param: string, selector: string, name: string, kind: 'fill' | 'select']> = [
  ['company_name', '#company-name', 'Company name', 'fill'], ['contact_email', '#contact-email', 'Contact email', 'fill'],
  ['tax_id', '#tax-id', 'Tax ID', 'fill'], ['address_line1', '#address-line1', 'Address line 1', 'fill'],
  ['city', '#city', 'City', 'fill'], ['postal_code', '#postal-code', 'Postal code', 'fill'],
  ['country', '#country', 'Country', 'select'], ['phone', '#phone', 'Phone', 'fill'],
];

class StaticB2Page implements BrowserPageSession, BrowserReplayPage {
  values = new Map<string, string>();
  clicks = 0;
  submitted = false;
  async navigate(): Promise<void> {}
  async capture(): Promise<CapturedPage> {
    if (this.submitted) return captureStaticHtml(URL, `<!doctype html><html><head><title>Vendor Registration</title></head><body><main><section role="status"><h2>${COMPLETE}</h2></section></main></body></html>`);
    const page = captureStaticHtml(URL, FORM_HTML);
    for (const element of page.elements) {
      const id = element.attributes['id'];
      const value = id ? this.values.get(`#${id}`) : undefined;
      if (value === undefined) continue;
      element.attributes['value'] = value;
      if (element.tag === 'select') element.text = value;
    }
    return page;
  }
  async fill(selector: string, value: string): Promise<void> { this.values.set(selector, value); }
  async select(selector: string, value: string): Promise<void> { this.values.set(selector, value); }
  async click(): Promise<void> { this.clicks += 1; if (FIELDS.every(([, selector]) => this.values.get(selector))) this.submitted = true; }
}

function scripted(values: Record<string, string>): BrowserPlannerClient {
  const actions: BrowserAction[] = [
    { kind: 'navigate', url: URL },
    ...FIELDS.map(([param, selector, name, kind]) => (kind === 'fill'
      ? { kind: 'fill' as const, selector, role: 'textbox', name, value: values[param]! }
      : { kind: 'select' as const, selector, role: 'combobox', name, value: values[param]! })),
    { kind: 'click', selector: '#registration-submit', role: 'button', name: 'Submit registration' },
    { kind: 'done', success: true, summary: 'registered' },
  ];
  let index = 0;
  return { async plan(source) { const action = actions[Math.min(index, actions.length - 1)]!; index += 1; return { action, usage: { source, input_tokens: 0, output_tokens: 0 } }; } };
}

class CountingLlm implements LlmClient {
  calls = 0;
  async complete(): Promise<never> { this.calls += 1; throw new Error('the matcher and replay must not call an LLM'); }
}

const fixtureEnv = buildEnvFingerprint({ tool_inventory: [{ name: 'browser.click', schema_hash: 'v1' }], target_identity: 'fixture.test', surface_versions: {} });
const prodEnv = buildEnvFingerprint({ tool_inventory: [{ name: 'browser.click', schema_hash: 'v1' }], target_identity: 'vendors.prod.example', surface_versions: {} });
let baseDir: string | undefined;
afterEach(async () => { if (baseDir) await rm(baseDir, { recursive: true, force: true }); baseDir = undefined; });

/** Records B2 through the live loop, distills, and adds the result to a fresh library. */
async function learn(env: EnvFingerprint = fixtureEnv) {
  baseDir = await mkdtemp(join(tmpdir(), 'rote-matcher-'));
  const recorder = new FileBrowserAgentRunRecorder({ task: 'Register Acme Tools as a vendor', envFingerprint: env, baseDir, runId: 'b2-record' });
  const result = await runBrowserAgent({
    task: 'Register Acme Tools as a vendor', page: new StaticB2Page(), planner: scripted(RECORD_VALUES),
    verifier: { async verify(capture) { const ok = capture.html.includes(COMPLETE); return { success: ok, summary: ok ? 'complete' : 'incomplete', ...(ok ? { checks: [{ text_visible: COMPLETE }] } : {}) }; } },
    recorder, maxSteps: 15,
  });
  expect(result.success).toBe(true);
  const run = await loadRecordedRun(baseDir, 'b2-record');
  const report = distillTrajectory(run.events, {
    playbookName: 'b2-vendor-registration', intentDescription: run.manifest.task_spec,
    envFingerprint: { domain: 'fixture.test', tool_prefixes: ['browser.'] },
    params: Object.entries(RECORD_VALUES).map(([name, value]) => ({ name, type: 'string' as const, value })),
  });
  const library = new FilePlaybookLibrary(baseDir);
  await library.add({ playbook: report.playbook, fingerprintHash: run.manifest.env_fingerprint.fingerprint_hash, sourceRunId: run.runId, addedAt: new Date('2026-08-16T00:00:00.000Z') });
  return { library, report };
}

describe('matcher fails closed', () => {
  it('T0: selects the learned playbook for a same-shape task with new params and replays it with zero model calls', async () => {
    const { library } = await learn();
    const candidates = await library.list();
    expect(candidates).toHaveLength(1);
    const match = matchPlaybook({ task: 'Register Blue Fern Supply as a vendor', params: NEW_VALUES, envFingerprint: fixtureEnv, candidates });
    expect(match.kind).toBe('match');
    if (match.kind !== 'match') return;
    expect(match.score).toBe(1);
    expect(match.entry.playbook.task_signature.intent_description).toBe('Register {{company_name}} as a vendor');
    const page = new StaticB2Page();
    const llm = new CountingLlm();
    const replay = await runPlaybook(match.entry.playbook, match.bindings, { toolCaller: new BrowserToolCaller(page), llmClient: llm, envFingerprint: fixtureEnv, taskSpec: 'Register Blue Fern Supply as a vendor', baseDir: baseDir! });
    expect(replay.outcome).toBe('success');
    expect(llm.calls).toBe(0);
    expect(page.values.get('#company-name')).toBe('Blue Fern Supply');
    expect(page.submitted).toBe(true);
  });

  it('T4: never selects the playbook for a near-miss task on the same site, and nothing is dispatched', async () => {
    const { library } = await learn();
    const candidates = await library.list();
    for (const task of ['Register Blue Fern Supply as a customer', 'Update the vendor Blue Fern Supply', 'Register Blue Fern Supply', 'Delete the vendor Blue Fern Supply']) {
      const result = matchPlaybook({ task, params: NEW_VALUES, envFingerprint: fixtureEnv, candidates });
      expect(result.kind, task).toBe('no_match');
      if (result.kind === 'no_match') expect(result.reason, task).toBe('below_threshold');
    }
    // A missing declared param is a miss even when the intent is exact.
    const { company_name: _omit, ...partial } = NEW_VALUES;
    expect(matchPlaybook({ task: 'Register Blue Fern Supply as a vendor', params: partial, envFingerprint: fixtureEnv, candidates })).toMatchObject({ kind: 'no_match', reason: 'params_unbound' });
  });

  it('never crosses environments: a playbook proved on another fingerprint is discarded before any semantic comparison', async () => {
    const { library } = await learn(prodEnv);
    const candidates = await library.list();
    expect(candidates[0]!.fingerprint_hash).toBe(prodEnv.fingerprint_hash);
    // Same site name in the task, perfect intent, exact params — wrong environment.
    expect(matchPlaybook({ task: 'Register Blue Fern Supply as a vendor', params: NEW_VALUES, envFingerprint: fixtureEnv, candidates })).toEqual({ kind: 'no_match', reason: 'fingerprint_mismatch', considered: 1 });
  });

  it('keeps the library append-only: versions are immutable files and the index recovers from an interrupted append', async () => {
    const { library, report } = await learn();
    await expect(library.add({ playbook: report.playbook, fingerprintHash: fixtureEnv.fingerprint_hash, addedAt: new Date() })).rejects.toBeInstanceOf(PlaybookVersionExistsError);
    const v2 = { ...report.playbook, version: 2 };
    await appendFile(playbookLibraryIndexPath(baseDir!), '{"version":1,"playbook":"cut', 'utf8');
    await library.add({ playbook: v2, fingerprintHash: fixtureEnv.fingerprint_hash, addedAt: new Date('2026-08-16T01:00:00.000Z') });
    const listed = await library.list();
    expect(listed.map((entry) => entry.playbook.version)).toEqual([1, 2]);
    expect(await readFile(playbookLibraryIndexPath(baseDir!), 'utf8')).toContain('"cut\n');
    // With both versions present the newest wins the match.
    expect(matchPlaybook({ task: 'Register Blue Fern Supply as a vendor', params: NEW_VALUES, envFingerprint: fixtureEnv, candidates: listed })).toMatchObject({ kind: 'match', entry: { playbook: { version: 2 } } });
  });

  it('recovers when the interrupted index append was cut at a closing brace', async () => {
    // A crash can truncate anywhere. The old rule tested the last byte for a
    // brace, so a fragment ending in `}` read as corruption and the whole
    // library became unlistable — every warm replay lost to one crash.
    const { library, report } = await learn();
    await appendFile(playbookLibraryIndexPath(baseDir!), '{"version":1,"fingerprint_hash":{"a":1}', 'utf8');
    await library.add({ playbook: { ...report.playbook, version: 2 }, fingerprintHash: fixtureEnv.fingerprint_hash, addedAt: new Date('2026-08-16T02:00:00.000Z') });
    expect((await library.list()).map((entry) => entry.playbook.version)).toEqual([1, 2]);
  });
});
