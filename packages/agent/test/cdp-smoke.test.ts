import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findChromeExecutable, FixtureSiteServer, LaunchingCdpBrowserBackend, type CdpPage } from '@rote/browser';
import { runBrowserAgent, type BrowserAction, type BrowserPlannerClient, type BrowserPlannerRequest } from '../src/index.js';

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

describe('browser-agent CDP fixture smoke', () => {
  it('drives B1-B3 fixture pages through the compact agent loop', async () => {
    if (process.env['ROTE_RUN_CDP_TESTS'] !== '1') return;
    const chromePath = findChromeExecutable();
    if (!chromePath) return;
    const server = await serveFixtures();
    const backend = new LaunchingCdpBrowserBackend({ chromePath });
    backends.push(backend);

    await expect(runFixtureTask(backend, server.url('b1-report.html'), [
      { kind: 'fill', selector: '#username', value: 'analyst', expect: { input_value: '#username', equals: 'analyst' } },
      { kind: 'fill', selector: '#password', value: 'secret', expect: { input_value: '#password', equals: 'secret' } },
      { kind: 'click', selector: '#login-submit', expect: { text_visible: 'Signed in to Reports Portal' } },
      { kind: 'click', selector: '#latest-report-download', expect: { text_visible: 'Report download complete' } },
      { kind: 'done', success: true, summary: 'download requested' },
    ], '#username', 'Report download complete')).resolves.toBe('download requested');

    await expect(runFixtureTask(backend, server.url('b2-vendor-form.html'), [
      { kind: 'fill', selector: '#company-name', value: 'Acme Tools', expect: { input_value: '#company-name', equals: 'Acme Tools' } },
      { kind: 'fill', selector: '#contact-email', value: 'ops@example.com', expect: { input_value: '#contact-email', equals: 'ops@example.com' } },
      { kind: 'select', selector: '#country', value: 'US', expect: { input_value: '#country', equals: 'US' } },
      { kind: 'click', selector: '#registration-submit', expect: { text_visible: 'Vendor registration complete' } },
      { kind: 'done', success: true, summary: 'vendor submitted' },
    ], '#registration-submit', 'Vendor registration complete')).resolves.toBe('vendor submitted');

    await expect(runFixtureTask(backend, server.url('b3-catalog.html'), [
      { kind: 'fill', selector: '#catalog-query', value: 'alpha', expect: { input_value: '#catalog-query', equals: 'alpha' } },
      { kind: 'click', selector: '#catalog-search-submit', expect: { selector_visible: '#open-alpha' } },
      { kind: 'click', selector: '#open-alpha', expect: { text_visible: 'Alpha product opened' } },
      { kind: 'done', success: true, summary: 'alpha opened' },
    ], '#catalog-query', 'Alpha product opened')).resolves.toBe('alpha opened');
  }, 45000);
});

async function runFixtureTask(
  backend: LaunchingCdpBrowserBackend,
  url: string,
  actions: BrowserAction[],
  expectedSelectorInObservation: string,
  finalVerificationText: string,
): Promise<string> {
  const page = await backend.openPage();
  pages.push(page);
  await page.navigate(url);
  const actionCount = actions.length;
  const planner = new ScriptedPlanner(actions);

  const result = await runBrowserAgent({
    task: `Smoke task for ${url}`,
    page,
    planner,
    verifier: {
      async verify(captured, _task, summary) {
        const text = [captured.title, ...captured.elements.map((element) => element.text)].join(' ');
        return text.includes(finalVerificationText)
          ? { success: true, summary }
          : { success: false, summary: `missing final text: ${finalVerificationText}` };
      },
    },
    maxSteps: 8,
  });

  expect(result.success).toBe(true);
  expect(planner.sources).toEqual(Array.from({ length: actionCount }, () => 'planner'));
  expect(planner.requests[0]?.observation.text).toContain(expectedSelectorInObservation);
  expect(planner.requests.every((request) => request.observation.approxTokens > 0)).toBe(true);
  return result.summary;
}

async function serveFixtures(): Promise<FixtureSiteServer> {
  const server = new FixtureSiteServer({ rootDir: resolve('../../fixtures/sites') });
  servers.push(server);
  await server.start();
  return server;
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
