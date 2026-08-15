import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserPageSession, BrowserPlannerClient } from '@rote/agent';
import { FilePlaybookLibrary } from '@rote/matcher';
import { FileSiteMemoryStore } from '@rote/site-memory';
import { continueBrowserTask, distillRun, main, runBrowserTask, type BrowserTaskBackend } from '../src/index.js';

// see docs/02-architecture.md "Learning" — the CLI closes the loop end to end:
// a cold run is recorded → `rote distill` learns a playbook (library) and site
// memory → `rote run` selects the playbook through the matcher for a same-shape
// task and replays it, or misses cleanly and runs cold with the site brief.

const START = 'https://portal.test/vendors/register';
const FORM = '<!doctype html><html><head><title>Vendor Registration</title></head><body><form id="registration-form"><label for="company-name">Company name</label><input id="company-name" name="company_name" /><button id="registration-submit" type="submit">Submit registration</button></form></body></html>';
const DONE = '<!doctype html><html><head><title>Vendor Registration</title></head><body><main><section role="status"><h2>Vendor registration complete</h2></section></main></body></html>';

/** Static two-state page for both the live loop and replay. */
class VendorPage implements BrowserPageSession {
  url = 'about:blank';
  fills: string[] = [];
  clicks = 0;
  private submitted = false;
  private value = '';
  async navigate(url: string): Promise<void> { this.url = url; }
  async capture() {
    if (this.submitted) return { url: `${START}#complete`, title: 'Vendor Registration', html: DONE, elements: [{ tag: 'h2', attributes: {}, text: 'Vendor registration complete', depth: 3 }] };
    return {
      url: this.url, title: 'Vendor Registration', html: FORM,
      elements: [
        { tag: 'form', attributes: { id: 'registration-form' }, text: '', depth: 1 },
        { tag: 'label', attributes: { for: 'company-name' }, text: 'Company name', depth: 2 },
        { tag: 'input', attributes: { id: 'company-name', name: 'company_name', ...(this.value ? { value: this.value } : {}) }, text: '', depth: 2 },
        { tag: 'button', attributes: { id: 'registration-submit', type: 'submit', 'data-rote-form-method': 'get', 'data-rote-form-action': 'https://portal.test/vendors/register' }, text: 'Submit registration', depth: 2 },
      ],
    };
  }
  async fill(_selector: string, value: string): Promise<void> { this.fills.push(value); this.value = value; }
  async select(): Promise<void> {}
  async click(): Promise<void> { this.clicks += 1; if (this.value) this.submitted = true; }
}
class FakeBackend implements BrowserTaskBackend {
  closed = false;
  constructor(private readonly page: VendorPage) {}
  async openPage(): Promise<BrowserPageSession> { return this.page; }
  async close(): Promise<void> { this.closed = true; }
}
function scripted(company: string): BrowserPlannerClient {
  const actions = [
    { kind: 'fill' as const, selector: '#company-name', role: 'textbox', name: 'Company name', value: company },
    { kind: 'click' as const, selector: '#registration-submit', role: 'button', name: 'Submit registration' },
    { kind: 'done' as const, success: true, summary: 'registered' },
  ];
  let index = 0;
  return { async plan(source) { const action = actions[Math.min(index, actions.length - 1)]!; index += 1; return { action, usage: { source, input_tokens: 10, output_tokens: 2 } }; } };
}

let baseDir: string | undefined;
afterEach(async () => { if (baseDir) await rm(baseDir, { recursive: true, force: true }); baseDir = undefined; });

async function recordCold(company: string, runId: string) {
  const page = new VendorPage();
  const result = await runBrowserTask({ task: `Register ${company} as a vendor`, url: START, baseDir, verifyText: 'Vendor registration complete', runId, params: { company_name: company } }, { backend: new FakeBackend(page), planner: scripted(company) });
  expect(result.success).toBe(true);
  return result;
}

describe('CLI learning loop', () => {
  it('records cold → distills into the library and site memory → matches and replays a same-shape task with zero tokens', async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'rote-cli-learn-'));
    const cold = await recordCold('Acme Tools', 'cold-1');
    expect(cold.phase).toBe('cold');
    expect(cold.selection).toEqual({ source: 'library', matched: false, reason: 'no_candidates', considered: 0 });
    expect(cold.siteBrief).toBeUndefined(); // empty memory renders nothing

    const distilled = await distillRun({ baseDir, runId: 'cold-1', playbookName: 'vendor-registration', params: { company_name: 'Acme Tools' }, clock: () => new Date('2026-08-16T00:00:00.000Z') });
    expect(distilled).toMatchObject({ playbook: 'vendor-registration', version: 1, kept: 2, contractedSteps: 2, verifySource: 'learned', usedParams: ['company_name'] });
    expect(distilled.siteMemoryRecords).toBeGreaterThan(0);
    const yaml = await readFile(distilled.playbookPath, 'utf8');
    expect(yaml).not.toContain('Acme Tools');
    expect(yaml).toContain('Register {{company_name}} as a vendor');
    expect(await new FilePlaybookLibrary(baseDir).list()).toHaveLength(1);
    expect((await new FileSiteMemoryStore(baseDir).read(distilled.fingerprintHash)).length).toBe(distilled.siteMemoryRecords);

    // Same-shape task, new params: the matcher selects the learned playbook and replay dispatches the new value with zero model calls.
    const warmPage = new VendorPage();
    const planner: BrowserPlannerClient = { async plan() { throw new Error('a matched replay must not plan'); } };
    const warm = await runBrowserTask({ task: 'Register Blue Fern Supply as a vendor', url: START, baseDir, verifyText: 'Vendor registration complete', params: { company_name: 'Blue Fern Supply' } }, { backend: new FakeBackend(warmPage), planner });
    expect(warm.phase).toBe('warm');
    expect(warm.selection).toMatchObject({ source: 'library', matched: true, playbook: 'vendor-registration', version: 1, score: 1, considered: 1 });
    expect(warm.inputTokens).toBe(0);
    expect(warmPage.fills).toEqual(['Blue Fern Supply']);

    // Near-miss task on the same site: no match, classified cold run, brief present (memory now non-empty), utility reported.
    const nearPage = new VendorPage();
    const near = await runBrowserTask({ task: 'Register Blue Fern Supply as a customer', url: START, baseDir, verifyText: 'Vendor registration complete', params: { company_name: 'Blue Fern Supply' } }, { backend: new FakeBackend(nearPage), planner: scripted('Blue Fern Supply') });
    expect(near.phase).toBe('cold');
    expect(near.selection).toMatchObject({ source: 'library', matched: false, reason: 'below_threshold', considered: 1 });
    expect(near.siteBrief).toMatchObject({ hinted: 2, used: 2 });
    expect(near.siteBrief!.chars).toBeLessThanOrEqual(1200);
    // A second cold run of the *same* task text: the shadow predictor built from the
    // first successful run agrees with the scripted planner on every step, dispatching nothing itself.
    const again = await runBrowserTask({ task: 'Register Acme Tools as a vendor', url: START, baseDir, verifyText: 'Vendor registration complete', siteBriefChars: 0 }, { backend: new FakeBackend(new VendorPage()), planner: scripted('Acme Tools') });
    expect(again.prediction).toEqual({ priorRuns: 1, predicted: 3, hits: 3 });
    // Brief disabled: cold path pays nothing.
    const off = await runBrowserTask({ task: 'Register Blue Fern Supply as a customer', url: START, baseDir, verifyText: 'Vendor registration complete', siteBriefChars: 0 }, { backend: new FakeBackend(new VendorPage()), planner: scripted('Blue Fern Supply') });
    expect(off.siteBrief).toBeUndefined();
  });

  it('exposes distill and run selection through the CLI, and parses the new flags', async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'rote-cli-learn-main-'));
    await recordCold('Acme Tools', 'cold-2');
    const out = await main(['distill', 'cold-2', '--name', 'vendor-registration', '--params', '{"company_name":"Acme Tools"}'], baseDir);
    expect(out).toContain('playbook: vendor-registration v1');
    expect(out).toContain('verify: learned');
    expect(out).toContain('site memory:');
    await expect(main(['distill', 'cold-2', '--name', 'vendor-registration', '--params', '{"company_name":"Acme Tools"}'], baseDir)).rejects.toThrow(/already exists/);
    await expect(main(['distill'], baseDir)).rejects.toThrow(/rote distill <run_id>/);
    await expect(main(['distill', 'cold-2', '--name', 'x', '--params', '[1]'], baseDir)).rejects.toThrow('--params must be a JSON object');

    const runBrowserTaskFake = vi.fn(async (options) => ({ runId: 'r', success: true, summary: 'ok', steps: 2, inputTokens: 0, outputTokens: 0, phase: 'warm' as const, selection: { source: 'library' as const, matched: true as const, playbook: 'vendor-registration', version: 1, score: 1, considered: 1 }, ...(options.params ? {} : {}) }));
    const printed = await main(['run', 'Register Blue Fern Supply as a vendor', '--url', START, '--verify-text', 'x', '--params', '{"company_name":"Blue Fern Supply"}', '--site-brief-chars', '800'], baseDir, { runBrowserTask: runBrowserTaskFake });
    expect(runBrowserTaskFake).toHaveBeenCalledWith(expect.objectContaining({ params: { company_name: 'Blue Fern Supply' }, siteBriefChars: 800 }));
    expect(printed).toContain('selection: library match vendor-registration v1 (score 1.00, 1 considered)');
    await expect(main(['run', 't', '--url', START, '--verify-text', 'x', '--site-brief-chars', '-1'], baseDir, { runBrowserTask: runBrowserTaskFake })).rejects.toThrow('--site-brief-chars must be a non-negative integer');
  });

  it('continues a playbook across two sessions through the CLI without repeating a completed step', async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'rote-cli-continue-'));
    await recordCold('Acme Tools', 'cold-3');
    const distilled = await distillRun({ baseDir, runId: 'cold-3', playbookName: 'vendor-registration', params: { company_name: 'Acme Tools' } });
    const first = new VendorPage();
    const session1 = await continueBrowserTask({ baseDir, taskId: 'vendor-42', playbookPath: distilled.playbookPath, url: START, params: { company_name: 'Blue Fern Supply' }, stopAfterStepId: 'fill_company_name' }, { backend: new FakeBackend(first) });
    expect(session1).toMatchObject({ mode: 'fresh', outcome: 'interrupted', checkpointsWritten: 1, resumedStepIds: [] });
    expect(first.fills).toEqual(['Blue Fern Supply']);
    expect(first.clicks).toBe(0);
    // Second session, new browser: the fill is not repeated; the click completes the task.
    const second = new VendorPage();
    second.fills.push('(pre-filled by the site)');
    (second as unknown as { value: string }).value = 'Blue Fern Supply';
    const session2 = await continueBrowserTask({ baseDir, taskId: 'vendor-42', playbookPath: distilled.playbookPath, url: START, params: { company_name: 'Blue Fern Supply' } }, { backend: new FakeBackend(second) });
    expect(session2).toMatchObject({ mode: 'resumed', resumedFromSeq: 0, resumedStepIds: ['fill_company_name'], outcome: 'success' });
    expect(second.fills).toEqual(['(pre-filled by the site)']);
    expect(second.clicks).toBe(1);
    // A different principal cannot pick the (now completed) task up: refused before any action.
    const third = new VendorPage();
    await expect(continueBrowserTask({ baseDir, taskId: 'vendor-42', playbookPath: distilled.playbookPath, url: START, params: { company_name: 'Blue Fern Supply' }, principal: 'someone-else' }, { backend: new FakeBackend(third) })).rejects.toMatchObject({ classification: 'continuation_state_mismatch', kind: 'principal' });
    expect(third.clicks).toBe(0);
    await expect(main(['continue'], baseDir)).rejects.toThrow(/rote continue <task_id>/);
  });
});
