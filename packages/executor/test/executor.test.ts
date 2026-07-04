import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseTrajectoryJsonl, RunManifestSchema, type Step } from '@rote/core';
import { runPaths } from '@rote/recorder';
import { JudgmentOutOfEnumError, runPlaybook, type ExecutorDeps } from '../src/executor.js';
import { completion, FakeLlmClient } from './helpers/fake-llm-client.js';
import { fail, FakeToolCaller, ok } from './helpers/fake-tool-caller.js';
import { fakeEnvFingerprint, makePlaybook } from './helpers/fixtures.js';

let baseDir: string;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'rote-executor-'));
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

function deps(overrides: Partial<ExecutorDeps> & Pick<ExecutorDeps, 'toolCaller' | 'llmClient'>): ExecutorDeps {
  return {
    envFingerprint: fakeEnvFingerprint(),
    taskSpec: 'test task',
    baseDir,
    runId: 'run-1',
    ...overrides,
  };
}

describe('runPlaybook: golden replay', () => {
  it('executes a 3-step deterministic playbook with the exact tool sequence and zero LLM calls', async () => {
    const steps: Step[] = [
      { id: 'open', depends_on: [], kind: 'deterministic', tool: 'nav', args: { url: 'https://x' }, on_fail: 'fallback' },
      { id: 'fill', depends_on: ['open'], kind: 'deterministic', tool: 'fill', args: { value: 'hi' }, on_fail: 'fallback' },
      { id: 'submit', depends_on: ['fill'], kind: 'deterministic', tool: 'submit', args: {}, on_fail: 'fallback' },
    ];
    const playbook = makePlaybook({ steps });
    const toolCaller = new FakeToolCaller({
      nav: () => ok({ url: 'https://x', visible_selectors: ['#form'] }),
      fill: () => ok({ input_values: { '#field': 'hi' } }),
      submit: () => ok({ text: 'done' }),
    });
    const llmClient = new FakeLlmClient(() => completion('unused'));

    const result = await runPlaybook(playbook, {}, deps({ toolCaller, llmClient }));

    expect(result.outcome).toBe('success');
    expect(result.completedStepIds).toEqual(['open', 'fill', 'submit']);
    expect(toolCaller.calls.map((c) => c.tool)).toEqual(['nav', 'fill', 'submit']);
    expect(llmClient.callCount).toBe(0);
  });

  it('records its own trajectory and a schema-valid manifest (replays are runs too)', async () => {
    const steps: Step[] = [
      { id: 'open', depends_on: [], kind: 'deterministic', tool: 'nav', args: {}, on_fail: 'fallback' },
    ];
    const playbook = makePlaybook({ steps });
    const toolCaller = new FakeToolCaller({ nav: () => ok({ text: 'ok' }) });
    const llmClient = new FakeLlmClient(() => completion('unused'));

    await runPlaybook(playbook, {}, deps({ toolCaller, llmClient, runId: 'run-golden' }));

    const paths = runPaths(baseDir, 'run-golden');
    const events = parseTrajectoryJsonl(await readFile(paths.trajectoryPath, 'utf8'));
    expect(events).toHaveLength(1);
    expect(events[0]?.tool).toBe('nav');

    const manifest = RunManifestSchema.parse(JSON.parse(await readFile(paths.manifestPath, 'utf8')));
    expect(manifest.outcome).toBe('success');
    expect(manifest.run_id).toBe('run-golden');
  });
});

describe('runPlaybook: param binding', () => {
  it('templates args from params; different params change only the templated fields', async () => {
    const steps: Step[] = [
      {
        id: 'greet',
        depends_on: [],
        kind: 'deterministic',
        tool: 'say',
        args: { message: 'hello {{name}}', channel: 'general' },
        on_fail: 'fallback',
      },
    ];
    const playbook = makePlaybook({ steps, params: [{ name: 'name', type: 'string' }] });
    const toolCallerA = new FakeToolCaller({ say: () => ok({ text: 'sent' }) });
    const toolCallerB = new FakeToolCaller({ say: () => ok({ text: 'sent' }) });
    const llmClient = new FakeLlmClient(() => completion('unused'));

    await runPlaybook(playbook, { name: 'alice' }, deps({ toolCaller: toolCallerA, llmClient, runId: 'run-a' }));
    await runPlaybook(playbook, { name: 'bob' }, deps({ toolCaller: toolCallerB, llmClient, runId: 'run-b' }));

    expect(toolCallerA.calls[0]?.args).toEqual({ message: 'hello alice', channel: 'general' });
    expect(toolCallerB.calls[0]?.args).toEqual({ message: 'hello bob', channel: 'general' });
  });
});

describe('runPlaybook: slot step', () => {
  it("lands the LLM's fill into the right arg of a later step", async () => {
    const steps: Step[] = [
      {
        id: 'summarize',
        depends_on: [],
        kind: 'slot',
        llm_fill: { prompt: 'summarize the ticket', max_tokens: 50, into: 'summary' },
        on_fail: 'fallback',
      },
      {
        id: 'save',
        depends_on: ['summarize'],
        kind: 'deterministic',
        tool: 'save',
        args: { text: '{{summary}}' },
        on_fail: 'fallback',
      },
    ];
    const playbook = makePlaybook({ steps, params: [] });
    const toolCaller = new FakeToolCaller({ save: () => ok({ text: 'saved' }) });
    const llmClient = new FakeLlmClient(() => completion('a great summary'));

    const result = await runPlaybook(playbook, {}, deps({ toolCaller, llmClient }));

    expect(result.outcome).toBe('success');
    expect(toolCaller.calls[0]?.args).toEqual({ text: 'a great summary' });
    expect(llmClient.requests[0]?.source).toBe('slot');
  });

  it("gates slot output on its own expect: garbage output fails the step and triggers on_fail", async () => {
    const steps: Step[] = [
      {
        id: 'summarize',
        depends_on: [],
        kind: 'slot',
        llm_fill: { prompt: 'summarize the ticket', max_tokens: 50, into: 'summary' },
        expect: { output_matches: '^SUMMARY:' },
        on_fail: 'fallback',
      },
    ];
    const playbook = makePlaybook({ steps });
    const toolCaller = new FakeToolCaller({});
    const llmClient = new FakeLlmClient(() => completion('garbage, not the expected shape'));

    const result = await runPlaybook(playbook, {}, deps({ toolCaller, llmClient }));

    expect(result.outcome).toBe('fallback');
    expect(result.failedStepId).toBe('summarize');
  });
});

describe('runPlaybook: judgment step', () => {
  it('throws a hard error when the classification is outside the declared enum, never a silent branch', async () => {
    const steps: Step[] = [
      {
        id: 'triage',
        depends_on: [],
        kind: 'judgment',
        llm_judge: { prompt: 'classify this ticket', options: ['approve', 'reject'] },
        on_fail: 'fallback',
      },
    ];
    const playbook = makePlaybook({ steps });
    const toolCaller = new FakeToolCaller({});
    const llmClient = new FakeLlmClient(() => completion('maybe'));

    await expect(runPlaybook(playbook, {}, deps({ toolCaller, llmClient }))).rejects.toThrow(JudgmentOutOfEnumError);
  });

  it('binds an in-enum classification for later steps to reference', async () => {
    const steps: Step[] = [
      {
        id: 'triage',
        depends_on: [],
        kind: 'judgment',
        llm_judge: { prompt: 'classify this ticket', options: ['approve', 'reject'] },
        on_fail: 'fallback',
      },
      {
        id: 'route',
        depends_on: ['triage'],
        kind: 'deterministic',
        tool: 'route',
        args: { decision: '{{triage}}' },
        on_fail: 'fallback',
      },
    ];
    const playbook = makePlaybook({ steps });
    const toolCaller = new FakeToolCaller({ route: () => ok({ text: 'routed' }) });
    const llmClient = new FakeLlmClient(() => completion('approve'));

    const result = await runPlaybook(playbook, {}, deps({ toolCaller, llmClient }));

    expect(result.outcome).toBe('success');
    expect(toolCaller.calls[0]?.args).toEqual({ decision: 'approve' });
    expect(llmClient.requests[0]?.source).toBe('judgment');
  });
});

describe('runPlaybook: retry policy', () => {
  it('fails twice, succeeds on the third attempt, and records 3 attempts', async () => {
    const steps: Step[] = [
      { id: 'flaky', depends_on: [], kind: 'deterministic', tool: 'flaky', args: {}, on_fail: 'retry' },
    ];
    const playbook = makePlaybook({ steps });
    const toolCaller = new FakeToolCaller({
      flaky: (_args, callIndex) => (callIndex < 2 ? fail('transient') : ok({ text: 'recovered' })),
    });
    const llmClient = new FakeLlmClient(() => completion('unused'));

    const result = await runPlaybook(playbook, {}, deps({ toolCaller, llmClient, sleep: async () => {} }));

    expect(result.outcome).toBe('success');
    expect(result.attempts['flaky']).toBe(3);
    expect(toolCaller.calls).toHaveLength(3);
  });
});

describe('runPlaybook: fallback policy', () => {
  it('exhausts retries, exits FALLBACK, and reports exactly which step died with partial completion visible', async () => {
    const steps: Step[] = [
      { id: 'step1', depends_on: [], kind: 'deterministic', tool: 'ok-tool', args: {}, on_fail: 'fallback' },
      { id: 'step2', depends_on: ['step1'], kind: 'deterministic', tool: 'bad-tool', args: {}, on_fail: 'retry' },
      { id: 'step3', depends_on: ['step2'], kind: 'deterministic', tool: 'never-reached', args: {}, on_fail: 'fallback' },
    ];
    const playbook = makePlaybook({ steps });
    const toolCaller = new FakeToolCaller({
      'ok-tool': () => ok({ text: 'fine' }),
      'bad-tool': () => fail('always broken'),
    });
    const llmClient = new FakeLlmClient(() => completion('unused'));

    const result = await runPlaybook(playbook, {}, deps({ toolCaller, llmClient, sleep: async () => {}, runId: 'run-fallback' }));

    expect(result.outcome).toBe('fallback');
    expect(result.failedStepId).toBe('step2');
    // no-side-effect-repeat guard: only the step(s) that actually completed are reported
    expect(result.completedStepIds).toEqual(['step1']);
    expect(toolCaller.calls.map((c) => c.tool)).not.toContain('never-reached');

    const paths = runPaths(baseDir, 'run-fallback');
    const events = parseTrajectoryJsonl(await readFile(paths.trajectoryPath, 'utf8'));
    // step1's success + 3 recorded attempts of step2's failure — partial trajectory intact
    expect(events.filter((e) => e.tool === 'ok-tool')).toHaveLength(1);
    expect(events.filter((e) => e.tool === 'bad-tool' && e.error)).toHaveLength(3);
  });

  it("downgrades on_fail: 'repair' to fallback, since repair isn't built until M6", async () => {
    const steps: Step[] = [
      { id: 'step1', depends_on: [], kind: 'deterministic', tool: 'bad-tool', args: {}, on_fail: 'repair' },
    ];
    const playbook = makePlaybook({ steps });
    const toolCaller = new FakeToolCaller({ 'bad-tool': () => fail('broken') });
    const llmClient = new FakeLlmClient(() => completion('unused'));

    const result = await runPlaybook(playbook, {}, deps({ toolCaller, llmClient }));

    expect(result.outcome).toBe('fallback');
    expect(toolCaller.calls).toHaveLength(1); // no retry attempts for a repair-policy step
  });
});
