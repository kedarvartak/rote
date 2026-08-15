import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SettledBrowserPageSession, SettlednessTimeoutError, type SettleRecord } from '@rote/action';
import {
  createEvidenceGatedVerifier,
  DEFAULT_HISTORY_COMPACTION_POLICY,
  FileBrowserAgentRunRecorder,
  runBrowserAgent,
  type BrowserAgentResult,
  type BrowserPageSession,
  type BrowserPlannerClient,
  type BrowserPlannerRequest,
} from '@rote/agent';
import { findChromeExecutable, LaunchingCdpBrowserBackend } from '@rote/browser';
import { buildEnvFingerprint, EvidencePolicySchema } from '@rote/core';
import { parseEnterpriseContractProtocol } from '../src/enterprise-contract.js';
import { certifyEndurance, ENDURANCE_SETTLEDNESS_POLICY, type EnduranceRunRecord, type EnduranceStepSample } from '../src/enterprise-endurance.js';
import { createEnterpriseOracleEvidenceAdapter } from '../src/enterprise-evidence.js';
import { EnterpriseFixtureServer } from '../src/enterprise-oracle.js';

// see docs/05-roadmap.md P2 item 7 (#132) — E7.6. Fifteen fresh runs drive the
// frozen E7-SPA-60 contract through the *product loop* (runBrowserAgent + settled
// CDP page + B4 compaction + E7.4 evidence gate) with a deterministic planner
// that only ever copies identity from the current observation. The frozen
// server oracle is the only success signal; the certification report is pure
// accounting over what the loop recorded.

const RUNS = 15;
const CONCURRENCY = 5;
const TRANSITIONS = 60;
// Below the fixture's full snapshot (~600 chars) so every post-bootstrap step
// must be served as a diff against the retained same-document base — the
// eviction path is exercised on every transition, not merely available.
const OBSERVATION_MAX_CHARS = 500;
const OBSERVATION_BOOTSTRAP_MAX_CHARS = 4_000;
const protocolPath = fileURLToPath(new URL('../../../scripts/bench/enterprise/protocol.json', import.meta.url));
const fixturesDir = resolve('../../fixtures/enterprise');
const enabled = process.env['ROTE_RUN_CDP_TESTS'] === '1';
const chromePath = enabled ? findChromeExecutable() : undefined;

let backend: LaunchingCdpBrowserBackend | undefined;
let recordsDir: string;

beforeAll(async () => {
  if (!enabled) return;
  expect(chromePath, 'E7.6 endurance certification requires Chrome/Chromium').toBeDefined();
  if (!chromePath) return;
  backend = new LaunchingCdpBrowserBackend({ chromePath, windowSize: { width: 1440, height: 900 } });
  recordsDir = await mkdtemp(join(tmpdir(), 'rote-endurance-'));
});

afterAll(async () => {
  await backend?.close();
});

describe('E7.6 single-session SPA endurance (real Chrome)', () => {
  it(`certifies ${RUNS} fresh ${TRANSITIONS}-transition runs under the frozen B4 policy with exact authoritative evidence`, async () => {
    if (!enabled || !backend) return;
    // Each run owns a fresh page target and a fresh fixture server (own oracle
    // state and reset generation); runs share only the Chrome process. Batches
    // keep wall-clock inside CI limits without letting runs share state.
    const records: EnduranceRunRecord[] = [];
    for (let batchStart = 0; batchStart < RUNS; batchStart += CONCURRENCY) {
      const batch = Array.from({ length: Math.min(CONCURRENCY, RUNS - batchStart) }, (_, offset) => enduranceRun(batchStart + offset));
      records.push(...await Promise.all(batch));
    }
    const certification = certifyEndurance(records, {
      minRuns: RUNS,
      transitions: TRANSITIONS,
      compactionPolicy: DEFAULT_HISTORY_COMPACTION_POLICY,
      observationMaxChars: OBSERVATION_MAX_CHARS,
      observationBootstrapMaxChars: OBSERVATION_BOOTSTRAP_MAX_CHARS,
      settleTimeoutMs: ENDURANCE_SETTLEDNESS_POLICY.timeoutMs,
    });
    await writeFile(join(recordsDir, 'T34-endurance-certification.json'), JSON.stringify({ certification, records }, null, 2));
    console.info(`[T34] certification report: ${join(recordsDir, 'T34-endurance-certification.json')}`);
    expect(certification.checks.filter((check) => !check.passed)).toEqual([]);
    expect(certification.certified).toBe(true);
  }, 600_000);

  it('rejects a re-issued stale identity after a remount before dispatch and completes through one grounded repair', async () => {
    if (!enabled || !backend) return;
    // The planner replays transition 3's identity (already dispatched, element
    // remounted away) at step 4. Fuzzy text would heal it onto "Advance
    // transition 4"; the loop must refuse pre-dispatch and correct once.
    const record = await enduranceRun(100, { replayStaleIdentityAtStep: 3 });
    expect(record.success).toBe(true);
    expect(record.evidence_exact).toBe(true);
    expect(record.dispatch_count).toBe(TRANSITIONS);
    expect(record.stale_identity_rejections).toBe(1);
  }, 120_000);

  it('bounds settledness under a long-lived background request instead of waiting forever', async () => {
    if (!enabled || !backend) return;
    // A request the page holds open for the whole session is background traffic.
    // Under the frozen policy (one tolerated pending request) the run completes;
    // with zero tolerance the first action fails with a typed timeout, not a hang.
    const holder = new LongPollServer();
    await holder.start();
    try {
      const strict = await enduranceRun(200, { longPollUrl: holder.url, maxPendingRequests: 0, timeoutMs: 1_000, transitions: 2 })
        .catch((error: unknown) => error);
      expect(strict).toBeInstanceOf(SettlednessTimeoutError);
      const tolerant = await enduranceRun(201, { longPollUrl: holder.url });
      expect(tolerant.success).toBe(true);
      expect(tolerant.evidence_exact).toBe(true);
      expect(tolerant.settle.timeouts).toBe(0);
    } finally {
      await holder.close();
    }
  }, 180_000);
});

interface EnduranceRunOptions {
  replayStaleIdentityAtStep?: number;
  longPollUrl?: string;
  maxPendingRequests?: number;
  timeoutMs?: number;
  transitions?: number;
}

type RunRecordWithRejections = EnduranceRunRecord & { stale_identity_rejections: number };

async function enduranceRun(runIndex: number, options: EnduranceRunOptions = {}): Promise<RunRecordWithRejections> {
  if (!backend) throw new Error('backend missing');
  const transitions = options.transitions ?? TRANSITIONS;
  const server = new EnterpriseFixtureServer(fixturesDir);
  await server.start();
  const generation = server.reset().generation;
  const page = await backend.openPage();
  const startedAt = Date.now();
  const settles: SettleRecord[] = [];
  let staleRejections = 0;
  try {
    await page.navigate(server.url('/spa-endurance.html'));
    if (options.longPollUrl) {
      await page.evaluate<void>(`void fetch(${JSON.stringify(options.longPollUrl)}, { mode: 'no-cors' }).catch(() => {})`);
    }
    const settled = new SettledBrowserPageSession(page, {
      ...ENDURANCE_SETTLEDNESS_POLICY,
      ...(options.maxPendingRequests === undefined ? {} : { maxPendingRequests: options.maxPendingRequests }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      onSettle: (record) => { settles.push(record); },
    });
    const runId = `endurance-${runIndex}`;
    const recorder = new FileBrowserAgentRunRecorder({
      task: 'Complete exactly 60 single-session transitions.',
      envFingerprint: buildEnvFingerprint({
        tool_inventory: [{ name: 'browser.click', schema_hash: 'v1' }],
        target_identity: 'spa-endurance.fixture',
        surface_versions: {},
      }),
      baseDir: recordsDir,
      runId,
    });
    const trajectoryPath = join(recordsDir, 'runs', runId, 'trajectory.jsonl');
    const stepSamples: EnduranceStepSample[] = [];
    const contextByStep = new Map<number, { context_chars: number; volatile_chars: number; visible_actions: number; compacted_through: number | null }>();

    const planner: BrowserPlannerClient = {
      async plan(source, request) {
        contextByStep.set(request.step, {
          context_chars: request.context.stablePrefix.length + request.context.volatileSuffix.length,
          volatile_chars: request.context.volatileSuffix.length,
          visible_actions: request.context.history.visibleActions.length,
          compacted_through: request.context.history.compaction?.throughActionIndex ?? null,
        });
        const usage = { source, input_tokens: 0, output_tokens: 0 };
        const completed = transitionFromUrl(request.page.url);
        if (completed >= transitions) {
          return { action: { kind: 'done', success: true, summary: `completed ${completed} transitions` }, usage };
        }
        const wanted = completed + 1;
        if (source === 'planner' && options.replayStaleIdentityAtStep === request.step && request.step > 0) {
          const stale = staleIdentityFromHistory(request);
          if (!stale) throw new Error('stale identity replay needs a prior dispatched click in history');
          return { action: stale, usage };
        }
        if (source === 'repair') staleRejections += 1;
        const grounded = groundedAdvance(request.observation.text, wanted);
        if (!grounded) throw new Error(`observation at step ${request.step} does not show "Advance transition ${wanted}":\n${request.observation.text}`);
        return { action: grounded, usage };
      },
    };

    const verifier = createEvidenceGatedVerifier({
      base: {
        async verify(capture) {
          const ok = capture.html.includes(`UI says transition ${transitions} complete`);
          return { success: ok, summary: ok ? 'ui status reports completion' : 'ui status does not report completion' };
        },
      },
      policy: EvidencePolicySchema.parse({ schema_version: 1, required: [{ evidence_class: 'fixture_oracle' }] }),
      adapters: [createEnterpriseOracleEvidenceAdapter({
        id: 'enterprise-oracle',
        oracleUrl: (subject) => server.url(`/api/oracle?task_id=${subject.task_id}`),
        fetchJson,
        clock: Date.now,
      })],
      subject: { task_id: 'spa-contract', run_id: runId },
      clock: Date.now,
      currentGeneration: async () => generation,
    });

    let settleCursor = 0;
    const result: BrowserAgentResult = await runBrowserAgent({
      task: 'Complete exactly 60 single-session transitions.',
      page: settled as unknown as BrowserPageSession,
      planner,
      verifier,
      recorder: {
        async recordStep(step) {
          await recorder.recordStep(step);
          const context = contextByStep.get(step.step);
          if (!context) throw new Error(`no planner context captured for step ${step.step}`);
          const settleMs = settles.slice(settleCursor).reduce((sum, entry) => sum + entry.elapsedMs, 0);
          settleCursor = settles.length;
          stepSamples.push({
            step: step.step,
            ...context,
            observation_chars: step.observation.text.length,
            observation_mode: step.observation.mode,
            route_changed: step.pageTransition?.routeChanged ?? false,
            document_changed: step.pageTransition?.documentChanged ?? false,
            settle_ms: settleMs,
            recorder_bytes: (await stat(trajectoryPath)).size,
          });
        },
        finish: (outcome, summary, usage) => recorder.finish(outcome, summary, usage),
      },
      maxSteps: transitions + 5,
      observationMaxChars: OBSERVATION_MAX_CHARS,
      observationBootstrapMaxChars: OBSERVATION_BOOTSTRAP_MAX_CHARS,
      historyCompactionPolicy: DEFAULT_HISTORY_COMPACTION_POLICY,
    });

    const oracle = await snapshot(server, 'spa-contract');
    const expected = (await expectedEvents('E7-SPA-60')).slice(0, transitions);
    const evidenceExact = JSON.stringify(projectEvents(oracle.events)) === JSON.stringify(expected);
    const dispatched = result.steps.filter((step) => step.action.kind !== 'done' && !step.error).length;
    return {
      run_index: runIndex,
      transitions_expected: transitions,
      transitions_completed: oracle.spa_transition_count,
      success: result.success,
      ...(result.failureClassification ? { failure_classification: result.failureClassification } : {}),
      evidence_exact: evidenceExact,
      dispatch_count: dispatched,
      steps: stepSamples,
      settle: {
        samples: settles.length,
        total_ms: settles.reduce((sum, entry) => sum + entry.elapsedMs, 0),
        max_ms: settles.reduce((max, entry) => Math.max(max, entry.elapsedMs), 0),
        timeouts: 0,
      },
      duration_ms: Date.now() - startedAt,
      stale_identity_rejections: staleRejections,
    };
  } finally {
    page.close();
    await server.close();
  }
}

/** Copies stableId + selector + role + name for the wanted button from the current observation only. */
function groundedAdvance(observation: string, wanted: number) {
  const pattern = new RegExp(`\\* \\[(v2:[0-9a-f]{16})\\] button (.+?) "Advance transition ${wanted}"$`, 'm');
  const match = pattern.exec(observation);
  if (!match) return undefined;
  return { kind: 'click' as const, selector: match[2]!, stableId: match[1]!, role: 'button', name: `Advance transition ${wanted}` };
}

function staleIdentityFromHistory(request: BrowserPlannerRequest) {
  const last = [...request.previousActions].reverse().find((action) => action.kind === 'click');
  return last && last.kind === 'click' ? { ...last } : undefined;
}

function transitionFromUrl(url: string): number {
  const match = /\/workflow\/(\d+)$/.exec(new URL(url).pathname);
  return match ? Number(match[1]) : 0;
}

interface ExpectedEvent { kind: string; target_key: string; payload_sha256: string; }
interface Snapshot { generation: number; spa_transition_count: number; events: Array<ExpectedEvent & { event_id: string; task_id: string }>; }

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

async function snapshot(server: EnterpriseFixtureServer, taskId: string): Promise<Snapshot> {
  return fetchJson(server.url(`/api/oracle?task_id=${taskId}`)) as Promise<Snapshot>;
}

/** Holds every request open until closed — the shape of a long-poll/SSE background channel. */
class LongPollServer {
  private server?: Server;
  private readonly pending: Array<() => void> = [];
  url = '';

  async start(): Promise<void> {
    this.server = createServer((_request, response) => {
      this.pending.push(() => response.end());
    });
    await new Promise<void>((resolveListen) => this.server!.listen(0, '127.0.0.1', () => resolveListen()));
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('long-poll server address unavailable');
    this.url = `http://127.0.0.1:${address.port}/hold`;
  }

  async close(): Promise<void> {
    for (const release of this.pending.splice(0)) release();
    await new Promise<void>((resolveClose) => this.server?.close(() => resolveClose()));
  }
}
