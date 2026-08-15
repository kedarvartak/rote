import { describe, expect, it } from 'vitest';
import { TaskCheckpointSchema } from '../src/index.js';

const checkpoint = {
  version: 1,
  checkpoint_id: 'cp-1',
  task_id: 'continuation-contract',
  seq: 0,
  written_at: '2026-08-15T00:00:00.000Z',
  env_fingerprint_hash: 'a'.repeat(16),
  principal_sha256: 'b'.repeat(64),
  procedure: { playbook: 'e7', version: 1, playbook_sha256: 'c'.repeat(64), completed_step_ids: ['fill_1'], step_bindings: {}, status: 'in_progress' },
  bindings_sha256: 'd'.repeat(64),
  evidence_refs: [{ evidence_class: 'fixture_oracle', adapter_id: 'oracle', payload_sha256: 'e'.repeat(64), freshness_generation: 3 }],
};

describe('task checkpoint schema (#133)', () => {
  it('accepts a digest-only checkpoint', () => {
    expect(TaskCheckpointSchema.parse(checkpoint)).toMatchObject({ seq: 0, procedure: { status: 'in_progress' } });
  });

  it('is strict: params, credentials, observations, or a raw principal never parse', () => {
    expect(() => TaskCheckpointSchema.parse({ ...checkpoint, bindings: { password: 'x' } })).toThrow();
    expect(() => TaskCheckpointSchema.parse({ ...checkpoint, principal: 'user-7' })).toThrow();
    expect(() => TaskCheckpointSchema.parse({ ...checkpoint, observation: '...' })).toThrow();
    expect(() => TaskCheckpointSchema.parse({ ...checkpoint, principal_sha256: 'user-7' })).toThrow();
    expect(() => TaskCheckpointSchema.parse({ ...checkpoint, evidence_refs: [{ ...checkpoint.evidence_refs[0], payload: [1] }] })).toThrow();
    expect(() => TaskCheckpointSchema.parse({ ...checkpoint, version: 2 })).toThrow();
  });
});
