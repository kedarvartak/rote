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
          action: { kind: 'click', selector: '#submit' },
          usage: { source, input_tokens: 12, output_tokens: 3 },
        };
      },
    };

    await expect(runBrowserAgent({
      task: 'Submit the form',
      page: failingPage(),
      planner,
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
});

function failingPage(): BrowserPageSession {
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
      throw new Error('button detached');
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
