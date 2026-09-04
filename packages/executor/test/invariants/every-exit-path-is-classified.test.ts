import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Step } from '@rote/core';
import { EXECUTOR_EXIT_CODES, runPlaybook, type ExecutorDeps, type ExecutorExitCode, type ExecutorResult } from '../../src/executor.js';
import { completion, FakeLlmClient } from '../helpers/fake-llm-client.js';
import { fail, ok, FakeToolCaller } from '../helpers/fake-tool-caller.js';
import { fakeEnvFingerprint, makePlaybook } from '../helpers/fixtures.js';

/**
 * SACRED: CLAUDE.md invariant 1 and "Errors: typed error classes with the
 * failing step/run id attached; never swallow an error into a boolean."
 *
 * A caller decides whether to fall back to the plain agent (invariant 2) from
 * the *classification*, not from prose. An unclassified terminal exit is
 * therefore indistinguishable from a clean stop at the boundary that matters
 * most. This suite walks every terminal exit the executor has and asserts each
 * one is classified — and that `EXECUTOR_EXIT_CODES` has no member no scenario
 * can reach, so the enum cannot drift ahead of the code.
 */

let baseDir: string;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'rote-executor-exit-'));
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

const STEP: Step = { id: 'download', depends_on: [], kind: 'deterministic', tool: 'download', args: {}, on_fail: 'fallback' };

async function run(
  tool: ReturnType<typeof ok> | ReturnType<typeof fail> | { ok: false; error: { message: string } },
  overrides: Partial<ExecutorDeps> = {},
  verify: ReturnType<typeof makePlaybook>['verify'] = [{ nonempty: true }],
): Promise<ExecutorResult> {
  const playbook = makePlaybook({ steps: [STEP], verify });
  return runPlaybook(playbook, {}, {
    toolCaller: new FakeToolCaller({ download: () => tool as never }),
    llmClient: new FakeLlmClient(() => completion('unused')),
    envFingerprint: fakeEnvFingerprint(),
    taskSpec: 'download report',
    baseDir,
    ...overrides,
  });
}

interface ExitScenario {
  code: ExecutorExitCode;
  outcome: ExecutorResult['outcome'];
  what: string;
  drive: () => Promise<ExecutorResult>;
}

const SCENARIOS: ExitScenario[] = [
  {
    code: 'VERIFY_FAILED',
    outcome: 'failure',
    what: 'every step passed but a run-level verify check did not',
    drive: () => run(ok({ text: 'still working...' }), {}, [{ text_visible: 'Download complete' }]),
  },
  {
    code: 'STEP_FAILED',
    outcome: 'fallback',
    what: 'a step failed and the tool boundary reported no code of its own',
    drive: () => run({ ok: false, error: { message: 'the tool gave no code' } }),
  },
  {
    code: 'CHECKPOINT_WRITE_FAILED',
    outcome: 'failure',
    what: 'a checkpoint could not be written after a completed step',
    drive: () => run(ok({ text: 'done' }), {
      onStepCompleted: async () => { throw new Error('disk full'); },
    }),
  },
  {
    code: 'INTERRUPTED',
    outcome: 'interrupted',
    what: 'the caller asked to stop after a named step',
    drive: () => run(ok({ text: 'done' }), { stopAfterStepId: 'download' }),
  },
];

describe('runPlaybook: every terminal exit is classified', () => {
  for (const scenario of SCENARIOS) {
    it(`classifies ${scenario.code} when ${scenario.what}`, async () => {
      const result = await scenario.drive();

      expect(result.outcome).toBe(scenario.outcome);
      expect(result.failureCode).toBe(scenario.code);
      expect(result.reason, 'a classified exit still explains itself in prose').toBeTruthy();
    });
  }

  it('leaves no exit code unreachable — the enum cannot drift ahead of the code', () => {
    const covered = new Set(SCENARIOS.map((scenario) => scenario.code));
    for (const code of EXECUTOR_EXIT_CODES) {
      expect(covered.has(code), `${code} is declared but no scenario reaches it`).toBe(true);
    }
    expect(covered.size).toBe(EXECUTOR_EXIT_CODES.length);
  });

  it('forwards a tool-layer code unchanged rather than flattening it to STEP_FAILED', async () => {
    const result = await run(fail('the contract changed under the same identity', 'BROWSER_CONTRACT_MISMATCH'));

    expect(result.outcome).toBe('fallback');
    expect(result.failureCode).toBe('BROWSER_CONTRACT_MISMATCH');
    expect(result.failedStepId).toBe('download');
  });

  it('never carries a code on success, and never omits one otherwise', async () => {
    const success = await run(ok({ text: 'done' }));
    expect(success.outcome).toBe('success');
    expect(success.failureCode).toBeUndefined();

    for (const scenario of SCENARIOS) {
      const result = await scenario.drive();
      expect(result.outcome).not.toBe('success');
      expect(result.failureCode, `${scenario.code} exit ended unclassified`).toBeDefined();
    }
  });

  it('attributes a failure to a step only when one is responsible', async () => {
    // A verify check is a property of the run: attributing it to the last step
    // would tell a caller a step misbehaved when every step passed.
    const verifyFailure = await run(ok({ text: 'still working...' }), {}, [{ text_visible: 'Download complete' }]);
    expect(verifyFailure.failedStepId).toBeUndefined();
    expect(verifyFailure.completedStepIds).toEqual(['download']);

    const stepFailure = await run({ ok: false, error: { message: 'the tool gave no code' } });
    expect(stepFailure.failedStepId).toBe('download');
  });
});
