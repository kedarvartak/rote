import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RunManifestSchema } from '@rote/core';
import type { BrowserPageSession, BrowserPlannerClient } from '@rote/agent';
import { runBrowserTask, type BrowserTaskBackend } from '../src/index.js';

let baseDir: string | undefined;

afterEach(async () => {
  if (baseDir) await rm(baseDir, { recursive: true, force: true });
  baseDir = undefined;
});

describe('runBrowserTask', () => {
  it('navigates, records the cold run, reports usage, and closes the browser', async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'rote-browser-task-'));
    const page = new FakePage();
    const backend = new FakeBackend(page);
    const planner: BrowserPlannerClient = {
      async plan(source) {
        return {
          action: { kind: 'done', success: true, summary: 'task complete' },
          usage: { source, input_tokens: 30, output_tokens: 5 },
        };
      },
    };

    const result = await runBrowserTask({
      task: 'Complete fixture task',
      url: 'https://portal.test/start',
      baseDir,
      maxSteps: 3,
      verifyText: 'Done',
    }, { backend, planner });

    expect(page.url).toBe('https://portal.test/start');
    expect(backend.closed).toBe(true);
    expect(result).toEqual(expect.objectContaining({
      success: true,
      summary: 'task verification passed',
      steps: 1,
      inputTokens: 30,
      outputTokens: 5,
    }));
    const manifest = RunManifestSchema.parse(JSON.parse(
      await readFile(join(baseDir, 'runs', result.runId, 'manifest.json'), 'utf8'),
    ));
    expect(manifest.outcome).toBe('success');
    expect(manifest.env_fingerprint.target_identity).toBe('portal.test');
  });

  it('records failure and closes the browser when initial navigation fails', async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'rote-browser-task-failure-'));
    const page = new FakePage(true);
    const backend = new FakeBackend(page);
    const planner: BrowserPlannerClient = {
      async plan(source) {
        return {
          action: { kind: 'done', success: true, summary: 'should not run' },
          usage: { source, input_tokens: 0, output_tokens: 0 },
        };
      },
    };

    await expect(runBrowserTask({
      task: 'Open unavailable fixture',
      url: 'https://portal.test/unavailable',
      baseDir,
      verifyText: 'Done',
    }, { backend, planner })).rejects.toThrow('navigation failed');

    expect(backend.closed).toBe(true);
    const runs = await readdir(join(baseDir, 'runs'));
    const manifest = RunManifestSchema.parse(JSON.parse(
      await readFile(join(baseDir, 'runs', runs[0]!, 'manifest.json'), 'utf8'),
    ));
    expect(manifest.outcome).toBe('failure');
    expect(manifest.token_usage).toEqual([]);
  });
});

class FakeBackend implements BrowserTaskBackend {
  closed = false;

  constructor(private readonly page: BrowserPageSession) {}

  async openPage(): Promise<BrowserPageSession> {
    return this.page;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakePage implements BrowserPageSession {
  url = 'about:blank';

  constructor(private readonly failNavigation = false) {}

  async navigate(url: string): Promise<void> {
    if (this.failNavigation) throw new Error('navigation failed');
    this.url = url;
  }

  async capture() {
    return {
      url: this.url,
      title: 'Fixture',
      html: '<button id="done">Done</button>',
      elements: [{ tag: 'button', attributes: { id: 'done' }, text: 'Done', depth: 0 }],
    };
  }

  async fill(): Promise<void> {}
  async select(): Promise<void> {}
  async click(): Promise<void> {}
}
