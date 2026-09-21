import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BrowserPageSession, BrowserPlannerClient } from '@rote/agent';
import { EXECUTOR_EXIT_CODES, type ExecutorExitCode } from '@rote/executor';
import {
  browserEnvironmentFingerprint,
  runBrowserTask,
  type BrowserTaskBackend,
  type BrowserTaskResult,
} from '../../src/index.js';

let root: string | undefined;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

describe('invariant: never worse than baseline', () => {
  it.each([
    ['replay_failed', async (): Promise<BrowserTaskResult> => ({
      runId: 'warm-failed', success: false, summary: 'verify text absent', steps: 2,
      inputTokens: 0, outputTokens: 0, phase: 'warm',
    })],
    ['replay_error', async (): Promise<BrowserTaskResult> => { throw new Error('replay transport broke'); }],
  ] as const)('restarts the plain agent when the selected replay ends with %s', async (reason, replay) => {
    root = await mkdtemp(join(tmpdir(), 'rote-replay-fallback-'));
    const target = new URL('https://portal.test/start');
    const candidate = join(root, 'candidate.json');
    await writeFile(candidate, JSON.stringify({
      playbook_path: 'unused.yaml',
      fingerprint_hash: browserEnvironmentFingerprint(target).fingerprint_hash,
      params: {},
    }));
    const page = new FakePage();
    const planner: BrowserPlannerClient = {
      async plan(source) {
        return {
          action: { kind: 'done', success: true, summary: 'plain agent complete' },
          usage: { source, input_tokens: 10, output_tokens: 2 },
        };
      },
    };

    const result = await runBrowserTask({
      task: 'Complete task', url: target.toString(), baseDir: root,
      verifyText: 'Done', replayCandidatePath: candidate,
    }, { backend: new FakeBackend(page), planner, runReplay: replay });

    expect(result).toMatchObject({
      success: true, phase: 'cold', fallbackReason: reason,
    });
    expect(result.fallbackDetail).toMatch(reason === 'replay_failed' ? /verify text absent/ : /transport broke/);
    expect(page.navigations).toEqual([target.toString()]);
  });
});

describe('invariant: a fallback says why, not only that', () => {
  // CLAUDE.md "Errors": fallback paths log *why* (classification), not just
  // *that*. The executor classifies every terminal exit (#203); before this
  // suite the CLI collapsed all of them into `replay_failed` plus prose, so a
  // failed verification and a failed checkpoint write were indistinguishable
  // to any caller reading the result.

  const covered = new Set<string>();

  it.each(EXECUTOR_EXIT_CODES)('carries the executor code %s through to the fallback', async (code) => {
    covered.add(code);
    const result = await fallbackRun(async () => ({
      runId: 'warm-failed', success: false, summary: `replay ended: ${code}`, steps: 1,
      inputTokens: 0, outputTokens: 0, phase: 'warm', failureCode: code,
    }));
    expect(result).toMatchObject({
      success: true, phase: 'cold', fallbackReason: 'replay_failed', fallbackCode: code,
    });
  });

  it('leaves no declared executor exit code without fallback coverage', () => {
    for (const code of EXECUTOR_EXIT_CODES) expect(covered.has(code)).toBe(true);
  });

  it('classifies a replay that threw rather than returned', async () => {
    const result = await fallbackRun(async () => { throw new Error('replay transport broke'); });
    expect(result).toMatchObject({ fallbackReason: 'replay_error', fallbackCode: 'REPLAY_THREW' });
    expect(result.fallbackDetail).toMatch(/transport broke/);
  });

  it('names an unclassified replay failure rather than passing it off as one of the known codes', async () => {
    // Unreachable through the real executor (its `finish` overloads make an
    // uncoded non-success exit a compile error) — asserted so that if some
    // other replay implementation ever returns one, it is visible.
    const result = await fallbackRun(async () => ({
      runId: 'warm-failed', success: false, summary: 'no code', steps: 1,
      inputTokens: 0, outputTokens: 0, phase: 'warm',
    }));
    expect(result.fallbackCode).toBe('REPLAY_UNCLASSIFIED');
    expect(EXECUTOR_EXIT_CODES).not.toContain(result.fallbackCode as ExecutorExitCode);
  });

  it('classifies the environment gate, which refuses before any replay runs', async () => {
    root = await mkdtemp(join(tmpdir(), 'rote-fingerprint-fallback-'));
    const target = new URL('https://portal.test/start');
    const candidate = join(root, 'candidate.json');
    await writeFile(candidate, JSON.stringify({
      playbook_path: 'unused.yaml',
      // proved on a different environment — the gate must refuse before any replay
      fingerprint_hash: browserEnvironmentFingerprint(new URL('https://other.test/start')).fingerprint_hash,
      params: {},
    }));
    let replayed = false;
    const result = await runBrowserTask({
      task: 'Complete task', url: target.toString(), baseDir: root,
      verifyText: 'Done', replayCandidatePath: candidate,
    }, {
      backend: new FakeBackend(new FakePage()),
      planner: donePlanner,
      runReplay: async () => { replayed = true; throw new Error('replay must not run'); },
    });
    expect(replayed).toBe(false);
    expect(result).toMatchObject({
      phase: 'cold', fallbackReason: 'fingerprint_mismatch', fallbackCode: 'FINGERPRINT_MISMATCH',
    });
  });

  it('never labels a run that did not fall back, and never falls back without a label', async () => {
    root = await mkdtemp(join(tmpdir(), 'rote-warm-success-'));
    const target = new URL('https://portal.test/start');
    const candidate = join(root, 'candidate.json');
    await writeFile(candidate, JSON.stringify({
      playbook_path: 'unused.yaml',
      fingerprint_hash: browserEnvironmentFingerprint(target).fingerprint_hash,
      params: {},
    }));
    const warm = await runBrowserTask({
      task: 'Complete task', url: target.toString(), baseDir: root,
      verifyText: 'Done', replayCandidatePath: candidate,
    }, {
      backend: new FakeBackend(new FakePage()),
      planner: donePlanner,
      runReplay: async () => ({
        runId: 'warm-ok', success: true, summary: 'verified browser replay passed', steps: 2,
        inputTokens: 0, outputTokens: 0, phase: 'warm',
      }),
    });
    expect(warm).toMatchObject({ success: true, phase: 'warm' });
    expect(warm.fallbackReason).toBeUndefined();
    expect(warm.fallbackCode).toBeUndefined();

    const fell = await fallbackRun(async () => ({
      runId: 'warm-failed', success: false, summary: 'verify text absent', steps: 2,
      inputTokens: 0, outputTokens: 0, phase: 'warm', failureCode: 'VERIFY_FAILED',
    }));
    expect(Boolean(fell.fallbackReason)).toBe(Boolean(fell.fallbackCode));
  });
});

const donePlanner: BrowserPlannerClient = {
  async plan(source) {
    return {
      action: { kind: 'done', success: true, summary: 'plain agent complete' },
      usage: { source, input_tokens: 10, output_tokens: 2 },
    };
  },
};

/** Runs a task whose warm replay is selected and then fails the given way. */
async function fallbackRun(replay: () => Promise<BrowserTaskResult>): Promise<BrowserTaskResult> {
  root = await mkdtemp(join(tmpdir(), 'rote-fallback-code-'));
  const target = new URL('https://portal.test/start');
  const candidate = join(root, 'candidate.json');
  await writeFile(candidate, JSON.stringify({
    playbook_path: 'unused.yaml',
    fingerprint_hash: browserEnvironmentFingerprint(target).fingerprint_hash,
    params: {},
  }));
  return runBrowserTask({
    task: 'Complete task', url: target.toString(), baseDir: root,
    verifyText: 'Done', replayCandidatePath: candidate,
  }, { backend: new FakeBackend(new FakePage()), planner: donePlanner, runReplay: replay });
}

class FakeBackend implements BrowserTaskBackend {
  constructor(private readonly page: BrowserPageSession) {}
  async openPage(): Promise<BrowserPageSession> { return this.page; }
  async close(): Promise<void> {}
}

class FakePage implements BrowserPageSession {
  navigations: string[] = [];
  async navigate(url: string): Promise<void> { this.navigations.push(url); }
  async capture() {
    return {
      url: this.navigations.at(-1) ?? 'about:blank', title: 'Fixture', html: '<button>Done</button>',
      elements: [{ tag: 'button', attributes: {}, text: 'Done', depth: 0 }],
    };
  }
  async fill(): Promise<void> {}
  async select(): Promise<void> {}
  async click(): Promise<void> {}
}
