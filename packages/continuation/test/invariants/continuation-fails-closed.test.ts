import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildEnvFingerprint, buildEvidenceEnvelope, PlaybookSchema, type AuthoritativeEvidenceAdapter, type EnvFingerprint, type Playbook } from '@rote/core';
import type { LlmClient, ToolCaller } from '@rote/executor';
import { ContinuationMismatchError, continueTask, FileCheckpointStore, MemoryCheckpointStore, type CheckpointStore } from '../../src/index.js';

// see docs/05-roadmap.md P2 item 9 (#133) — sacred invariants for continuation:
// a completed step is never dispatched again; every mismatch (environment,
// principal, procedure version, bindings, stale evidence, diverged state) stops
// before any action; checkpoints never carry inputs or secrets; resume is reported
// separately from the replay outcome.

const playbook: Playbook = PlaybookSchema.parse({
  playbook: 'checkpoints',
  version: 1,
  task_signature: { intent_description: 'Commit three checkpoints', env_fingerprint: { domain: 'fixture.test', tool_prefixes: ['fx.'] } },
  params: [{ name: 'note', type: 'string' }, { name: 'secret', type: 'string' }],
  steps: [
    { id: 'commit_1', kind: 'deterministic', tool: 'fx.commit', args: { checkpoint: 1, note: '{{note}}' } },
    { id: 'commit_2', kind: 'deterministic', tool: 'fx.commit', args: { checkpoint: 2, note: '{{note}}' }, depends_on: ['commit_1'] },
    { id: 'commit_3', kind: 'deterministic', tool: 'fx.commit', args: { checkpoint: 3, note: '{{note}}' }, depends_on: ['commit_2'] },
  ],
  verify: [{ text_visible: 'committed 3' }],
});
const params = { note: 'synthetic note', secret: 'hunter2' };

/** Fake downstream: records every dispatch and reports how many checkpoints it has committed. */
class FakeCommitTool implements ToolCaller {
  calls: number[] = [];
  async call(_tool: string, args: Record<string, unknown>) {
    this.calls.push(Number(args['checkpoint']));
    return { ok: true as const, result: { url: 'https://fixture.test/workflow', visible_text: [`committed ${Number(args['checkpoint'])}`] } };
  }
}
const noLlm: LlmClient = { async complete() { throw new Error('continuation must not call an LLM'); } };
const fingerprint = (identity = 'fixture.test'): EnvFingerprint => buildEnvFingerprint({ tool_inventory: [{ name: 'fx.commit', schema_hash: 'v1' }], target_identity: identity, surface_versions: {} });

let baseDir: string | undefined;
afterEach(async () => { if (baseDir) await rm(baseDir, { recursive: true, force: true }); baseDir = undefined; });

/** Oracle double: what the authoritative source currently says, plus its generation. */
class FakeOracle {
  committed: number[] = [];
  generation = 1;
  adapter(): AuthoritativeEvidenceAdapter {
    return {
      id: 'fake-oracle',
      collect: async (subject) => (this.committed.length === 0 ? [] : [buildEvidenceEnvelope({
        evidence_class: 'fixture_oracle', adapter_id: 'fake-oracle', source: 'mem://oracle', subject,
        collected_at_ms: 1_000, freshness_generation: this.generation, payload: [...this.committed],
      })]),
    };
  }
}

async function session(overrides: Partial<Parameters<typeof continueTask>[0]> & { store: CheckpointStore; tool?: FakeCommitTool; oracle?: FakeOracle }) {
  baseDir ??= await mkdtemp(join(tmpdir(), 'rote-continuation-'));
  const tool = overrides.tool ?? new FakeCommitTool();
  const oracle = overrides.oracle;
  return continueTask({
    taskId: 'continuation-contract',
    principal: 'user-7',
    playbook,
    params,
    executor: { toolCaller: tool, llmClient: noLlm, envFingerprint: fingerprint(), taskSpec: 'commit checkpoints', baseDir },
    ...(oracle ? { evidence: { adapters: [oracle.adapter()], subject: { task_id: 'continuation-contract', run_id: 'run-1' }, currentGeneration: async () => oracle.generation } } : {}),
    ...overrides,
  });
}

describe('continuation fails closed', () => {
  it('resumes across two restarts without repeating a completed step and reports resume separately from replay', async () => {
    const store = new MemoryCheckpointStore();
    const oracle = new FakeOracle();
    const toolFor = (oracleRef: FakeOracle) => {
      const tool = new FakeCommitTool();
      const original = tool.call.bind(tool);
      tool.call = async (name, args) => { const out = await original(name, args); oracleRef.committed.push(Number(args['checkpoint'])); return out; };
      return tool;
    };
    const first = await session({ store, oracle, tool: toolFor(oracle), stopAfterStepId: 'commit_1' });
    expect(first.mode).toBe('fresh');
    expect(first.replay.outcome).toBe('interrupted');
    expect(first.checkpointsWritten).toBe(1);

    const second = await session({ store, oracle, tool: toolFor(oracle), stopAfterStepId: 'commit_2' });
    expect(second).toMatchObject({ mode: 'resumed', resumedFromSeq: 0, resumedStepIds: ['commit_1'], checkpointsWritten: 1 });
    expect(second.replay.outcome).toBe('interrupted');

    const thirdTool = toolFor(oracle);
    const third = await session({ store, oracle, tool: thirdTool });
    expect(third).toMatchObject({ mode: 'resumed', resumedFromSeq: 1, resumedStepIds: ['commit_1', 'commit_2'], checkpointsWritten: 2 });
    expect(third.replay.outcome).toBe('success');
    expect(third.replay.completedStepIds).toEqual(['commit_1', 'commit_2', 'commit_3']);
    // INVARIANT: each checkpoint committed exactly once across all three sessions.
    expect(oracle.committed).toEqual([1, 2, 3]);
    expect(thirdTool.calls).toEqual([3]);
    const log = store.logs.get('continuation-contract')!;
    expect(log.map((entry) => [entry.seq, entry.procedure.status, entry.procedure.completed_step_ids.length])).toEqual([[0, 'in_progress', 1], [1, 'in_progress', 2], [2, 'in_progress', 3], [3, 'completed', 3]]);
    // Checkpoints carry digests and evidence refs, never inputs, secrets, or the principal.
    const serialized = JSON.stringify(log);
    for (const leaked of ['synthetic note', 'hunter2', 'user-7']) expect(serialized).not.toContain(leaked);
    expect(log[2]!.evidence_refs).toEqual([expect.objectContaining({ evidence_class: 'fixture_oracle', adapter_id: 'fake-oracle', freshness_generation: 1 })]);

    // A finished procedure cannot be resumed again.
    await expect(session({ store, oracle })).rejects.toMatchObject({ classification: 'continuation_state_mismatch', kind: 'already_completed' });
  });

  it.each([
    ['fingerprint', { executor: { envFingerprint: fingerprint('other.test') } }],
    ['principal', { principal: 'user-8' }],
    ['procedure_version', { playbook: { ...playbook, version: 2 } }],
    ['bindings', { params: { ...params, note: 'different note' } }],
  ] as const)('stops before any action on %s mismatch', async (kind, override) => {
    const store = new MemoryCheckpointStore();
    await session({ store, stopAfterStepId: 'commit_1' });
    const tool = new FakeCommitTool();
    const overrides: Record<string, unknown> = { ...override };
    if ('executor' in override) {
      overrides['executor'] = { toolCaller: tool, llmClient: noLlm, envFingerprint: override.executor.envFingerprint, taskSpec: 'commit checkpoints', baseDir };
    }
    await expect(session({ store, tool, ...(overrides as object) })).rejects.toMatchObject({ classification: 'continuation_state_mismatch', kind, dispatched: false });
    expect(tool.calls).toEqual([]);
  });

  it('stops before any action when the authoritative source was reset (stale) or moved (diverged)', async () => {
    const store = new MemoryCheckpointStore();
    const oracle = new FakeOracle();
    const tool = new FakeCommitTool();
    tool.call = async (name, args) => { oracle.committed.push(Number(args['checkpoint'])); return { ok: true, result: { url: 'u', visible_text: ['committed 1'] } }; };
    await session({ store, oracle, tool, stopAfterStepId: 'commit_1' });

    const staleTool = new FakeCommitTool();
    oracle.generation = 2; // fixture reset between sessions
    await expect(session({ store, oracle, tool: staleTool })).rejects.toBeInstanceOf(ContinuationMismatchError);
    await expect(session({ store, oracle, tool: staleTool })).rejects.toMatchObject({ kind: 'evidence_stale' });
    expect(staleTool.calls).toEqual([]);

    oracle.generation = 1;
    oracle.committed.push(2); // someone else acted in between
    const divergedTool = new FakeCommitTool();
    await expect(session({ store, oracle, tool: divergedTool })).rejects.toMatchObject({ kind: 'state_diverged' });
    expect(divergedTool.calls).toEqual([]);
  });

  it('never proceeds past a step whose checkpoint could not be written', async () => {
    const store = new MemoryCheckpointStore();
    const oracle = new FakeOracle();
    let unreachable = false;
    const flaky = oracle.adapter();
    const adapter: AuthoritativeEvidenceAdapter = { id: 'fake-oracle', collect: async (subject) => { if (unreachable) throw new Error('oracle unreachable'); return flaky.collect(subject); } };
    const tool = new FakeCommitTool();
    const original = tool.call.bind(tool);
    tool.call = async (name, args) => { const out = await original(name, args); oracle.committed.push(Number(args['checkpoint'])); if (Number(args['checkpoint']) === 1) unreachable = true; return out; };
    const result = await session({ store, tool, evidence: { adapters: [adapter], subject: { task_id: 'continuation-contract', run_id: 'run-1' } } });
    expect(result.replay.outcome).toBe('failure');
    expect(result.replay.failureCode).toBe('CHECKPOINT_WRITE_FAILED');
    // Step 2 never dispatched: an unrecorded side effect would be invisible to the next session.
    expect(tool.calls).toEqual([1]);
  });

  it('recovers from an interrupted checkpoint write using the last complete record', async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'rote-continuation-'));
    const store = new FileCheckpointStore(baseDir);
    await session({ store, stopAfterStepId: 'commit_2' });
    const complete = await store.latest('continuation-contract');
    expect(complete?.seq).toBe(1);
    // Simulate a crash mid-append: a partial trailing line.
    const { appendFile } = await import('node:fs/promises');
    const { checkpointLogPath } = await import('../../src/index.js');
    await appendFile(checkpointLogPath(baseDir, 'continuation-contract'), '{"version":1,"checkpoint_id":"cut-sho', 'utf8');
    expect((await store.latest('continuation-contract'))?.checkpoint_id).toBe(complete?.checkpoint_id);
    // Resume continues from that record and appends seq 2 — the partial line is never edited.
    const tool = new FakeCommitTool();
    const resumed = await session({ store, tool });
    expect(resumed.mode).toBe('resumed');
    expect(resumed.resumedFromSeq).toBe(1);
    expect(tool.calls).toEqual([3]);
    const all = await store.readAll('continuation-contract');
    expect(all.map((entry) => entry.seq)).toEqual([0, 1, 2, 3]);
    // A complete but invalid record anywhere is corruption — an error, not a silent skip.
    const { writeFile, readFile } = await import('node:fs/promises');
    const path = checkpointLogPath(baseDir, 'continuation-contract');
    const lines = (await readFile(path, 'utf8')).split('\n');
    lines[1] = '{"broken":true}';
    await writeFile(path, lines.join('\n'), 'utf8');
    await expect(store.readAll('continuation-contract')).rejects.toThrow();
  });

  it('recovers when the interrupted checkpoint write was cut at a closing brace', async () => {
    // A crash can truncate anywhere, and the next resume appends *after* the
    // fragment rather than editing it. Testing the last byte for a brace made
    // such a log raise forever, which strands the very task continuation
    // exists to rescue (sacred invariant 2).
    baseDir = await mkdtemp(join(tmpdir(), 'rote-continuation-'));
    const store = new FileCheckpointStore(baseDir);
    await session({ store, stopAfterStepId: 'commit_2' });
    const { appendFile } = await import('node:fs/promises');
    const { checkpointLogPath } = await import('../../src/index.js');
    await appendFile(checkpointLogPath(baseDir, 'continuation-contract'), '{"version":1,"evidence":{"a":1}', 'utf8');
    const resumed = await session({ store, tool: new FakeCommitTool() });
    expect(resumed.mode).toBe('resumed');
    expect((await store.readAll('continuation-contract')).map((entry) => entry.seq)).toEqual([0, 1, 2, 3]);
  });
});
