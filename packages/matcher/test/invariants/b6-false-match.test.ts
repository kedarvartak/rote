import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { captureStaticHtml, type CapturedPage } from '@rote/browser';
import { buildEnvFingerprint, parsePlaybookYaml } from '@rote/core';
import { BrowserToolCaller, runPlaybook, type BrowserReplayPage, type LlmClient } from '@rote/executor';
import { matchPlaybook, type PlaybookLibraryEntry } from '../../src/index.js';

// see docs/03-benchmark.md B6 / T4 — "superficially like B2, genuinely different:
// the false-match test (must miss)". Any T4 false replay is a design kill, so the
// certification is defence in depth: (1) the matcher misses B6 tasks on the B2
// playbook; (2) even a *forced* replay of the B2 playbook against the B6 page
// dispatches nothing that mutates — the contract gate stops the submit; and (3)
// no path reports success, because B6 never shows B2's confirmation.

const B2_URL = 'https://fixture.test/vendors/register';
const B6_URL = 'https://fixture.test/vendors/offboard';
const B2_HTML = readFileSync(resolve('../../fixtures/sites/b2-vendor-form.html'), 'utf8');
const B6_HTML = readFileSync(resolve('../../fixtures/sites/b6-vendor-offboarding.html'), 'utf8');
const VALUES = { initial_url: B2_URL, company_name: 'Acme Tools' };
const fingerprint = buildEnvFingerprint({ tool_inventory: [{ name: 'browser.click', schema_hash: 'v1' }], target_identity: 'fixture.test', surface_versions: {} });

/** Static page that serves one fixture at one URL and counts what a replay dispatches. */
class StaticPage implements BrowserReplayPage {
  fills: string[] = [];
  clicks: string[] = [];
  constructor(private readonly url: string, private readonly html: string) {}
  async navigate(): Promise<void> {}
  async capture(): Promise<CapturedPage> {
    const page = captureStaticHtml(this.url, this.html);
    for (const element of page.elements) if (element.attributes['id'] === 'company-name' && this.fills.length > 0) element.attributes['value'] = this.fills[this.fills.length - 1]!;
    return page;
  }
  async fill(_selector: string, value: string): Promise<void> { this.fills.push(value); }
  async select(): Promise<void> {}
  async click(selector: string): Promise<void> { this.clicks.push(selector); }
}
const noLlm: LlmClient = { async complete() { throw new Error('B6 certification must not call a model'); } };

let baseDir: string | undefined;
afterEach(async () => { if (baseDir) await rm(baseDir, { recursive: true, force: true }); baseDir = undefined; });

async function b2Entry(): Promise<PlaybookLibraryEntry> {
  const playbook = parsePlaybookYaml(await readFile(resolve('../../fixtures/playbooks/browser-b2-contract.yaml'), 'utf8'));
  return { playbook, fingerprint_hash: fingerprint.fingerprint_hash, playbook_path: 'browser-b2-contract.yaml' };
}

describe('B6 false-match certification (T4)', () => {
  it('the matcher misses every B6-shaped task on the B2 playbook while still selecting the B2 task', async () => {
    const candidates = [await b2Entry()];
    const params = { company_name: 'Acme Tools' };
    // The genuine B2 task, new params: match.
    expect(matchPlaybook({ task: 'Submit the vendor registration company field with contract-gated replay', params, envFingerprint: fingerprint, candidates }).kind).toBe('match');
    // B6-shaped tasks: same site, same words, different meaning — must miss, and only for the honest reason.
    for (const task of [
      'Submit the vendor deregistration company field with contract-gated replay',
      'Remove Acme Tools from the vendor register',
      'Offboard the vendor Acme Tools',
      'Submit the vendor registration company field, then delete the vendor',
    ]) {
      const result = matchPlaybook({ task, params, envFingerprint: fingerprint, candidates });
      expect(result.kind, task).toBe('no_match');
      if (result.kind === 'no_match') expect(result.reason, task).toBe('below_threshold');
    }
  });

  it('a forced replay of the B2 playbook against the B6 page dispatches no submit and never reports success', async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'rote-b6-'));
    const { playbook } = await b2Entry();
    // B6 at its own URL: identity resolves (same ids/names), the submit's contract does not (destination + POST + mutating).
    const own = new StaticPage(B6_URL, B6_HTML);
    const forced = await runPlaybook(playbook, { ...VALUES, initial_url: B6_URL }, { toolCaller: new BrowserToolCaller(own), llmClient: noLlm, envFingerprint: fingerprint, taskSpec: 'forced B6', baseDir });
    expect(forced.outcome).toBe('fallback');
    expect(forced.failureCode).toBe('BROWSER_CONTRACT_MISMATCH');
    expect(forced.failedStepId).toBe('submit_registration');
    expect(own.clicks).toEqual([]);
    // B6 swapped in at B2's URL (the site changed what the form does): same verdict.
    const swapped = new StaticPage(B2_URL, B6_HTML);
    const stopped = await runPlaybook(playbook, VALUES, { toolCaller: new BrowserToolCaller(swapped), llmClient: noLlm, envFingerprint: fingerprint, taskSpec: 'swapped B6', baseDir });
    expect(stopped.failureCode).toBe('BROWSER_CONTRACT_MISMATCH');
    expect(stopped.reason).toContain('navigation → mutating');
    expect(swapped.clicks).toEqual([]);
    // Control: the same playbook on the real B2 page walks through to the submit and, with the confirmation shown, succeeds.
    const control = new StaticPage(B2_URL, B2_HTML);
    control.click = async (selector: string) => { control.clicks.push(selector); (control as unknown as { html: string }).html = '<!doctype html><html><head><title>Vendor Registration</title></head><body><main><section role="status"><h2>Vendor registration complete</h2></section></main></body></html>'; };
    const ok = await runPlaybook(playbook, VALUES, { toolCaller: new BrowserToolCaller(control), llmClient: noLlm, envFingerprint: fingerprint, taskSpec: 'B2 control', baseDir });
    expect(ok.outcome).toBe('success');
    expect(control.clicks).toEqual(['#registration-submit']);
  });
});
