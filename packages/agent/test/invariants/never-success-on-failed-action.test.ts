import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildEnvFingerprint, RunManifestSchema, TrajectoryEventSchema } from '@rote/core';
import { FileBrowserAgentRunRecorder, runBrowserAgent, type BrowserPageSession, type BrowserPlannerClient } from '../../src/index.js';

let baseDir: string | undefined;

afterEach(async () => {
  if (baseDir) await rm(baseDir, { recursive: true, force: true });
  baseDir = undefined;
});

describe('browser agent recording: never reports success on a failed action', () => {
  it('records a failed manifest and errored action event when click throws', async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'rote-agent-invariant-'));
    const recorder = new FileBrowserAgentRunRecorder({
      task: 'Submit the form',
      envFingerprint: buildEnvFingerprint({
        tool_inventory: [{ name: 'browser.click', schema_hash: 'v1' }],
        target_identity: 'fixture.test',
        surface_versions: {},
      }),
      baseDir,
      runId: 'failed-action-run',
      clock: sequenceClock(),
    });
    const planner: BrowserPlannerClient = {
      async plan(source) {
        return {
          action: { kind: 'click', selector: '#submit', expect: { selector_visible: '#submit' } },
          usage: { source, input_tokens: 12, output_tokens: 3 },
        };
      },
    };

    await expect(runBrowserAgent({
      task: 'Submit the form',
      page: failingPage(),
      planner,
      verifier: { async verify() { return { success: true, summary: 'unreachable' }; } },
      recorder,
      clock: () => 100,
    })).rejects.toThrow('button detached');

    const runDir = join(baseDir, 'runs', 'failed-action-run');
    const manifest = RunManifestSchema.parse(JSON.parse(await readFile(join(runDir, 'manifest.json'), 'utf8')));
    const event = TrajectoryEventSchema.parse(JSON.parse((await readFile(join(runDir, 'trajectory.jsonl'), 'utf8')).trim()));
    expect(manifest.outcome).toBe('failure');
    expect(manifest.token_usage).toEqual([{ source: 'planner', input_tokens: 12, output_tokens: 3 }]);
    expect(event.tool).toBe('browser.click');
    expect(event.error?.message).toBe('button detached');
  });

  it('records failure when an action postcondition fails', async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'rote-agent-expect-invariant-'));
    const recorder = new FileBrowserAgentRunRecorder({
      task: 'Remove submit button',
      envFingerprint: buildEnvFingerprint({ tool_inventory: [], target_identity: 'fixture.test', surface_versions: {} }),
      baseDir,
      runId: 'failed-expect-run',
      clock: sequenceClock(),
    });
    const planner: BrowserPlannerClient = {
      async plan(source) {
        return {
          action: { kind: 'click', selector: '#submit', expect: { selector_absent: '#submit' } },
          usage: { source, input_tokens: 8, output_tokens: 2 },
        };
      },
    };

    await expect(runBrowserAgent({
      task: 'Remove submit button',
      page: failingPage(false),
      planner,
      verifier: { async verify() { return { success: true, summary: 'unreachable' }; } },
      recorder,
      clock: () => 100,
    })).rejects.toThrow('selector "#submit" still visible');

    const runDir = join(baseDir, 'runs', 'failed-expect-run');
    const manifest = RunManifestSchema.parse(JSON.parse(await readFile(join(runDir, 'manifest.json'), 'utf8')));
    const event = TrajectoryEventSchema.parse(JSON.parse((await readFile(join(runDir, 'trajectory.jsonl'), 'utf8')).trim()));
    expect(manifest.outcome).toBe('failure');
    expect(event.error?.message).toBe('selector "#submit" still visible');
  });

  it('records failure when the planner declares success but verification fails', async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'rote-agent-verify-invariant-'));
    const recorder = new FileBrowserAgentRunRecorder({
      task: 'Download report',
      envFingerprint: buildEnvFingerprint({
        tool_inventory: [],
        target_identity: 'fixture.test',
        surface_versions: {},
      }),
      baseDir,
      runId: 'failed-verify-run',
      clock: sequenceClock(),
    });
    const planner: BrowserPlannerClient = {
      async plan(source) {
        return {
          action: { kind: 'done', success: true, summary: 'I think it worked' },
          usage: { source, input_tokens: 8, output_tokens: 2 },
        };
      },
    };

    const result = await runBrowserAgent({
      task: 'Download report',
      page: failingPage(false),
      planner,
      verifier: { async verify() { return { success: false, summary: 'download confirmation absent' }; } },
      recorder,
      clock: () => 100,
    });

    const manifest = RunManifestSchema.parse(JSON.parse(
      await readFile(join(baseDir, 'runs', 'failed-verify-run', 'manifest.json'), 'utf8'),
    ));
    expect(result.success).toBe(false);
    expect(result.summary).toBe('download confirmation absent');
    expect(manifest.outcome).toBe('failure');
  });
});

function failingPage(failClick = true): BrowserPageSession {
  return {
    async navigate() {},
    async capture() {
      return {
        url: 'https://fixture.test/form',
        title: 'Form',
        html: '<button id="submit">Submit</button>',
        elements: [{ tag: 'button', attributes: { id: 'submit' }, text: 'Submit', depth: 0 }],
      };
    },
    async fill() {},
    async select() {},
    async click() {
      if (failClick) throw new Error('button detached');
    },
  };
}

function sequenceClock(): () => Date {
  let time = Date.parse('2026-07-10T00:00:00.000Z');
  return () => {
    const current = new Date(time);
    time += 1;
    return current;
  };
}
