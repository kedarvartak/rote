import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SettledBrowserPageSession } from '@rote/action';
import { FileBrowserAgentRunRecorder, runBrowserAgent, type BrowserAction, type BrowserPageSession, type BrowserPlannerClient } from '@rote/agent';
import { findChromeExecutable, FixtureSiteServer, LaunchingCdpBrowserBackend, type CdpPage } from '@rote/browser';
import { buildEnvFingerprint, parsePlaybookYaml, writePlaybookYaml } from '@rote/core';
import { BrowserToolCaller, runPlaybook, type LlmClient } from '@rote/executor';
import { distillTrajectory, loadRecordedRun } from '../../src/index.js';

// see docs/05-roadmap.md P2 item 8 — the distiller gate in a real browser: the
// B1 (login + download) and B2 (registration) fixture flows are recorded through
// the settled CDP loop with a zero-token scripted planner, distilled, and the
// untouched YAML replays through the CDP executor with zero LLM calls. Credential
// and form values are templated, never persisted.

let server: FixtureSiteServer | undefined;
let backend: LaunchingCdpBrowserBackend | undefined;
let pages: CdpPage[] = [];
let baseDir: string | undefined;

afterEach(async () => {
  for (const page of pages) page.close();
  pages = [];
  await backend?.close();
  backend = undefined;
  await server?.close();
  server = undefined;
  if (baseDir) await rm(baseDir, { recursive: true, force: true });
  baseDir = undefined;
});

const B2_VALUES: Record<string, string> = {
  company_name: 'Acme Tools', contact_email: 'ops@example.com', tax_id: '84-1129930', address_line1: '18 Harbor Way',
  city: 'Portland', postal_code: '97209', country: 'US', phone: '503-555-0148',
};
const B2_FIELDS: Array<[string, string, string, 'fill' | 'select']> = [
  ['company_name', '#company-name', 'Company name', 'fill'], ['contact_email', '#contact-email', 'Contact email', 'fill'],
  ['tax_id', '#tax-id', 'Tax ID', 'fill'], ['address_line1', '#address-line1', 'Address line 1', 'fill'],
  ['city', '#city', 'City', 'fill'], ['postal_code', '#postal-code', 'Postal code', 'fill'],
  ['country', '#country', 'Country', 'select'], ['phone', '#phone', 'Phone', 'fill'],
];
const B1_VALUES = { username: 'analyst', password: 'secret' };

class CountingLlm implements LlmClient {
  calls = 0;
  async complete(): Promise<never> { this.calls += 1; throw new Error('replay must not call an LLM'); }
}

function scripted(actions: BrowserAction[]): BrowserPlannerClient {
  let index = 0;
  return { async plan(source) { const action = actions[Math.min(index, actions.length - 1)]!; index += 1; return { action, usage: { source, input_tokens: 0, output_tokens: 0 } }; } };
}

const fingerprint = () => buildEnvFingerprint({ tool_inventory: [{ name: 'browser.click', schema_hash: 'v1' }], target_identity: 'fixture', surface_versions: {} });

async function record(runId: string, task: string, actions: BrowserAction[], completeText: string) {
  const page = await backend!.openPage();
  pages.push(page);
  const settled = new SettledBrowserPageSession(page, { quietWindowMs: 100 });
  const recorder = new FileBrowserAgentRunRecorder({ task, envFingerprint: fingerprint(), baseDir: baseDir!, runId });
  const result = await runBrowserAgent({
    task,
    page: settled as unknown as BrowserPageSession,
    planner: scripted(actions),
    verifier: { async verify(capture) { const ok = capture.html.includes(completeText); return { success: ok, summary: ok ? 'complete' : 'incomplete' }; } },
    recorder,
    maxSteps: 15,
  });
  expect(result.success).toBe(true);
  return loadRecordedRun(baseDir!, runId);
}

async function replayYaml(yaml: string, params: Record<string, string>) {
  const page = await backend!.openPage();
  pages.push(page);
  const llm = new CountingLlm();
  const result = await runPlaybook(parsePlaybookYaml(yaml), params, {
    toolCaller: new BrowserToolCaller(page),
    llmClient: llm,
    envFingerprint: fingerprint(),
    taskSpec: 'distilled replay',
    baseDir: baseDir!,
  });
  expect(llm.calls).toBe(0);
  return { result, page };
}

describe('distilled playbooks replay the fixture suite in real Chrome', () => {
  it('records, distills, and replays B1 (login + download) and B2 (registration) with zero edits and zero LLM calls', async () => {
    if (process.env['ROTE_RUN_CDP_TESTS'] !== '1') return;
    const chromePath = findChromeExecutable();
    if (!chromePath) return;
    baseDir = await mkdtemp(join(tmpdir(), 'rote-distill-chrome-'));
    server = new FixtureSiteServer({ rootDir: resolve('../../fixtures/sites') });
    await server.start();
    backend = new LaunchingCdpBrowserBackend({ chromePath });
    const baseUrl = server.url('').replace(/\/$/, '');

    // B1: credentials are declared params and must not survive in the YAML.
    const b1 = await record('b1', 'Sign in as analyst and download the latest report', [
      { kind: 'navigate', url: `${baseUrl}/b1-report.html` },
      { kind: 'fill', selector: '#username', role: 'textbox', name: 'Username', value: B1_VALUES.username },
      { kind: 'fill', selector: '#password', role: 'textbox', name: 'Password', value: B1_VALUES.password },
      { kind: 'click', selector: '#login-submit', role: 'button', name: 'Sign in' },
      { kind: 'click', selector: '#latest-report-download', role: 'button', name: 'Download latest report' },
      { kind: 'done', success: true, summary: 'downloaded' },
    ], 'quarterly-report.pdf');
    const b1Report = distillTrajectory(b1.events, {
      playbookName: 'b1-distilled',
      intentDescription: b1.manifest.task_spec,
      envFingerprint: { domain: '127.0.0.1', tool_prefixes: ['browser.'] },
      params: [
        { name: 'base_url', type: 'string', value: baseUrl },
        { name: 'username', type: 'string', value: B1_VALUES.username },
        { name: 'password', type: 'string', value: B1_VALUES.password },
      ],
      verify: [{ text_visible: 'quarterly-report.pdf' }],
    });
    const b1Yaml = writePlaybookYaml(b1Report.playbook);
    expect(b1Yaml).not.toContain('secret');
    expect(b1Yaml).not.toContain('analyst');
    expect(b1Report.contractedStepIds).toHaveLength(4);
    const b1Replay = await replayYaml(b1Yaml, { base_url: baseUrl, ...B1_VALUES });
    expect(b1Replay.result.outcome).toBe('success');
    expect(await b1Replay.page.evaluate<string>(`document.querySelector('#download-confirmation').textContent`)).toContain('quarterly-report.pdf');

    // B2: eight typed values, all templated; exact confirmation summary verified.
    const b2 = await record('b2', 'Register Acme Tools as a vendor', [
      { kind: 'navigate', url: `${baseUrl}/b2-vendor-form.html` },
      ...B2_FIELDS.map(([param, selector, name, kind]) => (kind === 'fill'
        ? { kind: 'fill' as const, selector, role: 'textbox', name, value: B2_VALUES[param]! }
        : { kind: 'select' as const, selector, role: 'combobox', name, value: B2_VALUES[param]! })),
      { kind: 'click', selector: '#registration-submit', role: 'button', name: 'Submit registration' },
      { kind: 'done', success: true, summary: 'registered' },
    ], 'Vendor registration complete');
    const summary = `Vendor registration complete | ${Object.entries(B2_VALUES).map(([key, value]) => `${key}=${value}`).join(' | ')}`;
    const b2Report = distillTrajectory(b2.events, {
      playbookName: 'b2-distilled',
      intentDescription: b2.manifest.task_spec,
      envFingerprint: { domain: '127.0.0.1', tool_prefixes: ['browser.'] },
      params: [{ name: 'base_url', type: 'string', value: baseUrl }, ...Object.entries(B2_VALUES).map(([name, value]) => ({ name, type: 'string' as const, value }))],
      verify: [{ text_visible: `Vendor registration complete | ${Object.keys(B2_VALUES).map((key) => `${key}={{${key}}}`).join(' | ')}` }],
    });
    const b2Yaml = writePlaybookYaml(b2Report.playbook);
    for (const value of Object.values(B2_VALUES)) expect(b2Yaml).not.toContain(value);
    expect(b2Report.playbook.steps).toHaveLength(10);
    const b2Replay = await replayYaml(b2Yaml, { base_url: baseUrl, ...B2_VALUES });
    expect(b2Replay.result.outcome).toBe('success');
    expect(await b2Replay.page.evaluate<string>(`document.querySelector('#registration-summary').textContent`)).toBe(summary);
  }, 120_000);
});
