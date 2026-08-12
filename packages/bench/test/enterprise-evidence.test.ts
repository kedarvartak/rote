import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { evaluateEvidencePolicy, EvidencePolicySchema } from '@rote/core';
import { createEnterpriseOracleEvidenceAdapter } from '../src/enterprise-evidence.js';
import { EnterpriseFixtureServer } from '../src/enterprise-oracle.js';

const fixturesDir = fileURLToPath(new URL('../../../fixtures/enterprise', import.meta.url));
const subject = { task_id: 'grid-contract', run_id: 'run-1' };
const policy = EvidencePolicySchema.parse({ schema_version: 1, required: [{ evidence_class: 'fixture_oracle' }] });

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`oracle responded ${response.status}`);
  return response.json();
}

describe('enterprise oracle evidence adapter (live fixture server)', () => {
  let server: EnterpriseFixtureServer;
  let generation: number;

  beforeEach(async () => {
    server = new EnterpriseFixtureServer(fixturesDir);
    await server.start();
    generation = server.reset().generation;
  });

  afterEach(async () => {
    await server.close();
  });

  function adapter() {
    return createEnterpriseOracleEvidenceAdapter({
      id: 'enterprise-oracle',
      oracleUrl: (evidenceSubject) => server.url(`/api/oracle?task_id=${evidenceSubject.task_id}`),
      fetchJson,
      clock: () => 1_000,
    });
  }

  async function postEvent(taskId: string): Promise<void> {
    const response = await fetch(server.url('/api/events'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event_id: `event-${taskId}-1`,
        task_id: taskId,
        kind: 'grid_activated',
        target_key: 'row-7',
        payload: { row: 7 },
      }),
    });
    if (response.status !== 201) throw new Error(`event post failed: ${response.status}`);
  }

  it('satisfies the policy only from a recorded authoritative event', async () => {
    // Before any effect: the oracle attests to nothing, so the outcome is missing —
    // whatever the harness or the fixture DOM would claim.
    const before = evaluateEvidencePolicy(policy, await adapter().collect(subject), {
      subject, now_ms: 2_000, current_generation: generation,
    });
    expect(before).toMatchObject({ satisfied: false, classification: 'authoritative_effect_missing' });

    await postEvent(subject.task_id);
    const after = evaluateEvidencePolicy(policy, await adapter().collect(subject), {
      subject, now_ms: 2_000, current_generation: generation,
    });
    expect(after).toMatchObject({ satisfied: true });
  });

  it('never lets another task’s recorded event satisfy this task', async () => {
    await postEvent('other-contract');
    const verdict = evaluateEvidencePolicy(policy, await adapter().collect(subject), {
      subject, now_ms: 2_000, current_generation: generation,
    });
    // The oracle endpoint filters per task, so foreign effects surface as missing —
    // and even a snapshot answering for the wrong task would be a subject mismatch.
    expect(verdict.satisfied).toBe(false);
  });

  it('rejects evidence collected before a fixture reset as stale', async () => {
    await postEvent(subject.task_id);
    const envelopes = await adapter().collect(subject);
    const nextGeneration = server.reset().generation;
    const verdict = evaluateEvidencePolicy(policy, envelopes, {
      subject, now_ms: 2_000, current_generation: nextGeneration,
    });
    expect(verdict).toMatchObject({ satisfied: false, classification: 'authoritative_evidence_stale' });
  });

  it('throws instead of returning envelopes when the oracle is unreachable', async () => {
    const url = server.url('/api/oracle?task_id=grid-contract');
    await server.close();
    const dead = createEnterpriseOracleEvidenceAdapter({
      id: 'enterprise-oracle',
      oracleUrl: () => url,
      fetchJson,
      clock: () => 1_000,
    });
    await expect(dead.collect(subject)).rejects.toThrow();
  });
});
