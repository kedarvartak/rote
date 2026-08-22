import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SettledBrowserPageSession, type SettleableBrowserPage } from '@rote/action';
import { findChromeExecutable, FixtureSiteServer, LaunchingCdpBrowserBackend, type CdpPage } from '@rote/browser';
import { buildEnvFingerprint } from '@rote/core';
import { loadRecordedRun } from '@rote/distiller';
import { deriveSiteMemory, type SiteMemoryEvent } from '../src/index.js';
import { FileBrowserAgentRunRecorder, runBrowserAgent, type BrowserAction, type BrowserPlannerClient, type BrowserPlannerRequest } from '@rote/agent';

// T42 (docs/testing/T42-settle-priors-end-to-end.md): the settle telemetry
// added in #168 measured through the whole product path — real Chrome, the
// settledness gate, the agent loop, the crash-safe recorder, and site-memory
// derivation — with zero LLM calls. This is the fake-planner twin of what a
// billed `rote run` records on every step.

let servers: FixtureSiteServer[] = [];
let backends: LaunchingCdpBrowserBackend[] = [];
let pages: CdpPage[] = [];

afterEach(async () => {
  for (const page of pages) page.close();
  pages = [];
  await Promise.all(backends.map((backend) => backend.close()));
  backends = [];
  await Promise.all(servers.map((server) => server.close()));
  servers = [];
});

class ScriptedPlanner implements BrowserPlannerClient {
  constructor(private readonly actions: BrowserAction[]) {}
  async plan(source: 'planner', _request: BrowserPlannerRequest) {
    const action = this.actions.shift();
    if (!action) throw new Error('script exhausted');
    return { action, usage: { source, input_tokens: 10, output_tokens: 2 } };
  }
}

describe('settle priors end-to-end (real Chrome, zero LLM)', () => {
  it('records measured settles per dispatched step and derives per-kind settle priors from the run', async () => {
    if (process.env['ROTE_RUN_CDP_TESTS'] !== '1') return;
    const chromePath = findChromeExecutable();
    if (!chromePath) return;
    const server = new FixtureSiteServer({ rootDir: resolve('../../fixtures/sites') });
    servers.push(server);
    await server.start();
    const backend = new LaunchingCdpBrowserBackend({ chromePath });
    backends.push(backend);
    const raw = await backend.openPage();
    pages.push(raw);
    const page = new SettledBrowserPageSession(raw as unknown as SettleableBrowserPage, { timeoutMs: 5000 });
    await page.navigate(server.url('b2-vendor-form.html'));

    const baseDir = await mkdtemp(join(tmpdir(), 'rote-t42-'));
    const fingerprint = buildEnvFingerprint({
      tool_inventory: [{ name: 'browser', schema_hash: 'settle-e2e' }],
      target_identity: '127.0.0.1',
      surface_versions: {},
    });
    const recorder = new FileBrowserAgentRunRecorder({ task: 'T42 settle telemetry', envFingerprint: fingerprint, baseDir });
    const planner = new ScriptedPlanner([
      { kind: 'fill', selector: '#company-name', value: 'Acme Tools', expect: { input_value: '#company-name', equals: 'Acme Tools' } },
      { kind: 'fill', selector: '#contact-email', value: 'ops@example.com' },
      { kind: 'fill', selector: '#tax-id', value: '84-1129930' },
      { kind: 'fill', selector: '#address-line1', value: '18 Harbor Way' },
      { kind: 'fill', selector: '#city', value: 'Portland' },
      { kind: 'fill', selector: '#postal-code', value: '97209' },
      { kind: 'select', selector: '#country', value: 'US', expect: { input_value: '#country', equals: 'US' } },
      { kind: 'fill', selector: '#phone', value: '503-555-0148' },
      { kind: 'click', selector: '#registration-submit', expect: { text_visible: 'Vendor registration complete' } },
      { kind: 'done', success: true, summary: 'vendor submitted' },
    ]);
    const result = await runBrowserAgent({
      task: 'Register Acme Tools (T42)',
      page: page as never,
      planner,
      verifier: {
        async verify(captured, _task, summary) {
          const text = [captured.title, ...captured.elements.map((element) => element.text)].join(' ');
          return text.includes('Vendor registration complete') ? { success: true, summary } : { success: false, summary: 'missing confirmation' };
        },
      },
      recorder,
      maxSteps: 12,
    });
    expect(result.success).toBe(true);

    // Every dispatched step carries a measured, non-negative settle.
    const dispatched = result.steps.filter((step) => step.action.kind !== 'done');
    expect(dispatched).toHaveLength(9);
    for (const step of dispatched) {
      expect(step.settleMs).toBeTypeOf('number');
      expect(step.settleMs!).toBeGreaterThanOrEqual(0);
    }

    // The recorded run derives per-kind settle priors on the form's page key.
    const loaded = await loadRecordedRun(baseDir, recorder.runId);
    const report = deriveSiteMemory(loaded.events as SiteMemoryEvent[], {
      fingerprintHash: fingerprint.fingerprint_hash,
      runId: recorder.runId,
      observedAt: new Date().toISOString(),
    });
    const priors = report.records.filter((record) => record.kind === 'settle_prior');
    const byKind = Object.fromEntries(priors.map((prior) => prior.kind === 'settle_prior' ? [prior.action_kind, prior] : []));
    expect(byKind['fill']).toMatchObject({ samples: 7 });
    expect(byKind['select']).toMatchObject({ samples: 1 });
    expect(byKind['click']).toMatchObject({ samples: 1 });
    for (const prior of priors) {
      if (prior.kind !== 'settle_prior') continue;
      expect(prior.p50_ms).toBeLessThanOrEqual(prior.p90_ms);
      expect(prior.p90_ms).toBeLessThanOrEqual(prior.max_ms);
      expect(prior.page_key).toMatch(/^[0-9a-f]{16}$/);
    }
  }, 60_000);
});
