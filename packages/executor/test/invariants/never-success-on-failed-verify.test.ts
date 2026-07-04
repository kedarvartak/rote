import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Step } from '@rote/core';
import { runPlaybook } from '../../src/executor.js';
import { completion, FakeLlmClient } from '../helpers/fake-llm-client.js';
import { ok, FakeToolCaller } from '../helpers/fake-tool-caller.js';
import { fakeEnvFingerprint, makePlaybook } from '../helpers/fixtures.js';

/**
 * Sacred invariant #1 (CLAUDE.md, project invariants): "never silently
 * wrong — no code path may report success when a verify/expect check
 * failed." This is the executor's contribution to the invariant suite —
 * every PR touching the executor must add or strengthen a test here.
 */

let baseDir: string;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'rote-executor-invariant-'));
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

describe('runPlaybook: never reports success on a failed verify', () => {
  it('reports failure when every step passed but the final verify check fails', async () => {
    const steps: Step[] = [
      { id: 'download', depends_on: [], kind: 'deterministic', tool: 'download', args: {}, on_fail: 'fallback' },
    ];
    const playbook = makePlaybook({
      steps,
      verify: [{ text_visible: 'Download complete' }],
    });
    // Every step succeeds, but the tool result never actually says "Download complete".
    const toolCaller = new FakeToolCaller({ download: () => ok({ text: 'still working...' }) });
    const llmClient = new FakeLlmClient(() => completion('unused'));

    const result = await runPlaybook(
      playbook,
      {},
      { toolCaller, llmClient, envFingerprint: fakeEnvFingerprint(), taskSpec: 'download report', baseDir },
    );

    expect(result.outcome).toBe('failure');
    expect(result.outcome).not.toBe('success');
    expect(result.completedStepIds).toEqual(['download']); // every step really did pass
  });
});
