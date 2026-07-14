import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parsePlaybookYaml } from '@rote/core';
import { findChromeExecutable, FixtureSiteServer, LaunchingCdpBrowserBackend, type CdpPage } from '@rote/browser';
import { BrowserToolCaller, runPlaybook } from '../src/index.js';
import { FakeLlmClient, completion } from './helpers/fake-llm-client.js';
import { fakeEnvFingerprint } from './helpers/fixtures.js';

let baseDir: string | undefined;
let server: FixtureSiteServer | undefined;
let backend: LaunchingCdpBrowserBackend | undefined;
let pages: CdpPage[] = [];

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

describe('CDP verified browser replay', () => {
  it('replays stateful B1 and B2 with zero LLM calls', async () => {
    if (process.env['ROTE_RUN_CDP_TESTS'] !== '1') return;
    const chromePath = findChromeExecutable();
    if (!chromePath) return;
    baseDir = await mkdtemp(join(tmpdir(), 'rote-cdp-replay-'));
    server = new FixtureSiteServer({ rootDir: resolve('../../fixtures/sites') });
    await server.start();
    backend = new LaunchingCdpBrowserBackend({ chromePath });
    const llm = new FakeLlmClient(() => completion('unused'));

    const b1 = await replay('browser-b1-stateful.yaml', {
      base_url: server.url('').replace(/\/$/, ''), username: 'analyst', password: 'secret',
    }, llm);
    const b2 = await replay('browser-b2-stateful.yaml', {
      base_url: server.url('').replace(/\/$/, ''),
      company_name: 'Acme Tools',
      contact_email: 'ops@example.com',
      country: 'US',
    }, llm);

    expect(b1.outcome).toBe('success');
    expect(b2.outcome).toBe('success');
    expect(llm.callCount).toBe(0);
  }, 45000);
});

async function replay(
  fixtureName: string,
  params: Record<string, unknown>,
  llm: FakeLlmClient,
) {
  const playbook = parsePlaybookYaml(
    await readFile(resolve('../../fixtures/playbooks', fixtureName), 'utf8'),
  );
  const page = await backend!.openPage();
  pages.push(page);
  return runPlaybook(playbook, params, {
    toolCaller: new BrowserToolCaller(page),
    llmClient: llm,
    envFingerprint: fakeEnvFingerprint(),
    taskSpec: fixtureName,
    baseDir,
  });
}
