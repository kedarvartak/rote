import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { findChromeExecutable, LaunchingCdpBrowserBackend, type CdpPage } from '@rote/browser';
import { ContinuationMismatchError, continueTask, FileCheckpointStore } from '@rote/continuation';
import { buildEnvFingerprint, PlaybookSchema, type Playbook } from '@rote/core';
import { BrowserToolCaller, type LlmClient, type ToolCaller } from '@rote/executor';
import { parseEnterpriseContractProtocol } from '../src/enterprise-contract.js';
import { createEnterpriseOracleEvidenceAdapter } from '../src/enterprise-evidence.js';
import { EnterpriseFixtureServer } from '../src/enterprise-oracle.js';

// see docs/05-roadmap.md P2 item 9 (#133) — E7-CONTINUATION-RESTART and
// E7-CONTINUATION-MISMATCH through the product path: `continueTask` over the
// contract-gated CDP executor, with the E7.1 fixture oracle as authoritative
// evidence, across two real Chrome process restarts. Every browser process is
// closed between sessions; the checkpoint log is the only thing that survives.

const protocolPath = fileURLToPath(new URL('../../../scripts/bench/enterprise/protocol.json', import.meta.url));
const fixturesDir = resolve('../../fixtures/enterprise');
const CHECKPOINT_INPUT = 'html > body > section:nth-of-type(2) > label > input';
const COMMIT_BUTTON = 'html > body > section:nth-of-type(2) > button';

let server: EnterpriseFixtureServer | undefined;
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

const noLlm: LlmClient = { async complete() { throw new Error('continuation must not call an LLM'); } };

function playbook(): Playbook {
  const steps = [];
  let previous: string | undefined;
  for (const checkpoint of [1, 2, 3]) {
    const fill = `fill_checkpoint_${checkpoint}`;
    const click = `click_commit_${checkpoint}`;
    // The unnamed number input only has a CSS-path selector (no id/name), which the
    // world-state `input_values` convention cannot key; the commit's UI text and the
    // authoritative oracle carry the verification instead.
    steps.push({ id: fill, kind: 'deterministic', tool: 'browser.fill', args: { selector: CHECKPOINT_INPUT, value: `{{checkpoint_${checkpoint}}}` }, depends_on: previous ? [previous] : [] });
    steps.push({ id: click, kind: 'deterministic', tool: 'browser.click', args: { selector: COMMIT_BUTTON, role: 'button', name: 'Commit synthetic checkpoint' }, depends_on: [fill], expect: { text_visible: `UI says checkpoint ${checkpoint} committed` } });
    previous = click;
  }
  return PlaybookSchema.parse({
    playbook: 'e7-continuation',
    version: 1,
    task_signature: { intent_description: 'Commit checkpoints 1, 2, and 3 across two controlled browser-process restarts.', env_fingerprint: { domain: '127.0.0.1', tool_prefixes: ['browser.'] } },
    params: [1, 2, 3].map((checkpoint) => ({ name: `checkpoint_${checkpoint}`, type: 'string' })),
    steps,
    verify: [{ text_visible: 'UI says checkpoint 3 committed' }],
  });
}

/** Counts every dispatch reaching the browser tool caller. */
class CountingToolCaller implements ToolCaller {
  calls = 0;
  constructor(private readonly inner: ToolCaller) {}
  async call(tool: string, args: Record<string, unknown>) {
    this.calls += 1;
    return this.inner.call(tool, args);
  }
}

/** One browser process: opened for a session, closed before the next — nothing but the checkpoint log survives. */
async function newProcess(chromePath: string): Promise<CdpPage> {
  await backend?.close();
  backend = new LaunchingCdpBrowserBackend({ chromePath, windowSize: { width: 1280, height: 800 } });
  const page = await backend.openPage();
  pages.push(page);
  return page;
}

async function session(chromePath: string, options: { principal?: string; stopAfterStepId?: string; params?: Record<string, string> }) {
  const page = await newProcess(chromePath);
  const tool = new CountingToolCaller(new BrowserToolCaller(page));
  const url = server!.url('/spa-endurance.html');
  const result = continueTask({
    taskId: 'continuation-contract',
    principal: options.principal ?? 'analyst-1',
    playbook: playbook(),
    params: options.params ?? { checkpoint_1: '1', checkpoint_2: '2', checkpoint_3: '3' },
    store: new FileCheckpointStore(baseDir!),
    executor: {
      toolCaller: tool,
      llmClient: noLlm,
      envFingerprint: buildEnvFingerprint({ tool_inventory: [{ name: 'browser.click', schema_hash: 'v1' }], target_identity: 'spa-endurance.fixture', surface_versions: {} }),
      taskSpec: 'commit checkpoints across restarts',
      baseDir: baseDir!,
    },
    evidence: {
      adapters: [createEnterpriseOracleEvidenceAdapter({
        id: 'enterprise-oracle',
        oracleUrl: (subject) => server!.url(`/api/oracle?task_id=${subject.task_id}`),
        fetchJson,
        clock: Date.now,
      })],
      subject: { task_id: 'continuation-contract', run_id: 'continuation-run' },
      currentGeneration: async () => (await snapshot('continuation-contract')).generation,
    },
    resumeUrl: url,
    // A new browser process starts blank; session setup is the caller's, not a step.
    prepareSession: async () => { await page.navigate(url); },
    ...(options.stopAfterStepId ? { stopAfterStepId: options.stopAfterStepId } : {}),
  });
  return { result, tool };
}

describe('E7.7 multi-session continuation (real Chrome)', () => {
  it('commits checkpoints 1, 2, 3 across two process restarts to the exact authoritative outcome and stops before action on mismatch', async () => {
    if (process.env['ROTE_RUN_CDP_TESTS'] !== '1') return;
    const chromePath = findChromeExecutable();
    expect(chromePath, 'E7.7 continuation requires Chrome/Chromium').toBeDefined();
    if (!chromePath) return;
    baseDir = await mkdtemp(join(tmpdir(), 'rote-continuation-chrome-'));
    server = new EnterpriseFixtureServer(fixturesDir);
    await server.start();
    server.reset();

    // Session 1: fresh, commit checkpoint 1, then the process goes away.
    const first = await session(chromePath, { stopAfterStepId: 'click_commit_1' });
    const firstResult = await first.result;
    expect(firstResult.mode).toBe('fresh');
    expect(firstResult.replay.outcome).toBe('interrupted');
    expect((await snapshot('continuation-contract')).events).toHaveLength(1);

    // Session 2: new process, resume from checkpoint seq 1, commit 2, go away.
    const second = await session(chromePath, { stopAfterStepId: 'click_commit_2' });
    const secondResult = await second.result;
    expect(secondResult).toMatchObject({ mode: 'resumed', resumedStepIds: ['fill_checkpoint_1', 'click_commit_1'] });
    expect(secondResult.replay.outcome).toBe('interrupted');
    // Only this session's two steps dispatched — nothing was repeated.
    expect(second.tool.calls).toBe(2);

    // Session 3: new process, resume, finish.
    const third = await session(chromePath, {});
    const thirdResult = await third.result;
    expect(thirdResult).toMatchObject({ mode: 'resumed', resumedStepIds: ['fill_checkpoint_1', 'click_commit_1', 'fill_checkpoint_2', 'click_commit_2'] });
    expect(thirdResult.replay.outcome).toBe('success');
    expect(third.tool.calls).toBe(2);
    const oracle = await snapshot('continuation-contract');
    expect(projectEvents(oracle.events)).toEqual(await expectedEvents('E7-CONTINUATION-RESTART'));

    // E7-CONTINUATION-MISMATCH (a): a completed procedure is not resumable — no dispatch.
    const done = await session(chromePath, {});
    await expect(done.result).rejects.toMatchObject({ classification: 'continuation_state_mismatch', kind: 'already_completed' });
    expect(done.tool.calls).toBe(0);

    // E7-CONTINUATION-MISMATCH (b): fresh task log after checkpoint 1, then the
    // fixture resets (generation bump) — the checkpoint's evidence is stale; and
    // a different principal must not pick it up either. Zero dispatches in both.
    await rm(baseDir, { recursive: true, force: true });
    server.reset();
    await (await session(chromePath, { stopAfterStepId: 'click_commit_1' })).result;
    expect((await snapshot('continuation-contract')).events).toHaveLength(1);
    server.reset();
    const stale = await session(chromePath, {});
    await expect(stale.result).rejects.toBeInstanceOf(ContinuationMismatchError);
    expect(stale.tool.calls).toBe(0);
    expect((await snapshot('continuation-contract')).events).toHaveLength(0);
    const otherPrincipal = await session(chromePath, { principal: 'analyst-2' });
    await expect(otherPrincipal.result).rejects.toMatchObject({ kind: 'principal' });
    expect(otherPrincipal.tool.calls).toBe(0);
  }, 180_000);
});

interface ExpectedEvent { kind: string; target_key: string; payload_sha256: string; }
interface Snapshot { generation: number; events: Array<ExpectedEvent & { event_id: string; task_id: string }>; }

async function expectedEvents(caseId: string): Promise<ExpectedEvent[]> {
  const protocol = parseEnterpriseContractProtocol(JSON.parse(await readFile(protocolPath, 'utf8')));
  const contract = protocol.cases.find((candidate) => candidate.id === caseId);
  if (!contract || contract.oracle.kind !== 'server_state') throw new Error(`server-state contract missing: ${caseId}`);
  return contract.oracle.expected_events.map(({ kind, target_key, payload_sha256 }) => ({ kind, target_key, payload_sha256 }));
}

function projectEvents(events: Snapshot['events']): ExpectedEvent[] {
  return events.map(({ kind, target_key, payload_sha256 }) => ({ kind, target_key, payload_sha256 }));
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`oracle responded ${response.status}`);
  return response.json();
}

async function snapshot(taskId: string): Promise<Snapshot> {
  return fetchJson(server!.url(`/api/oracle?task_id=${taskId}`)) as Promise<Snapshot>;
}
