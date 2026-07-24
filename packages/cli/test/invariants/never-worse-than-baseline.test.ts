import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BrowserPageSession, BrowserPlannerClient } from '@rote/agent';
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
