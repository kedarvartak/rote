import { describe, it, expect } from 'vitest';
import { RunManifestSchema } from '../src/schemas/run-manifest.js';
import { buildEnvFingerprint } from '../src/schemas/env-fingerprint.js';

const envFingerprint = buildEnvFingerprint({
  tool_inventory: [{ name: 'browser.navigate', schema_hash: 'abc' }],
  target_identity: 'example.com',
  surface_versions: {},
});

function baseManifest(overrides: Record<string, unknown> = {}) {
  return {
    run_id: 'run-1',
    task_spec: 'download the latest report',
    env_fingerprint: envFingerprint,
    outcome: 'success',
    started_at: '2026-01-01T00:00:00.000Z',
    ended_at: '2026-01-01T00:00:05.000Z',
    token_usage: [{ source: 'planner', input_tokens: 100, output_tokens: 20 }],
    ...overrides,
  };
}

describe('RunManifestSchema', () => {
  it('accepts a well-formed manifest', () => {
    expect(RunManifestSchema.safeParse(baseManifest()).success).toBe(true);
  });

  it('accepts a manifest with no ended_at (still running)', () => {
    const { ended_at: _ended_at, ...rest } = baseManifest();
    expect(RunManifestSchema.safeParse(rest).success).toBe(true);
  });

  it('accepts a judgment-sourced token usage entry (M2 playbook judgment steps)', () => {
    const m = baseManifest({
      token_usage: [{ source: 'judgment', input_tokens: 50, output_tokens: 5 }],
    });
    expect(RunManifestSchema.safeParse(m).success).toBe(true);
  });

  it('rejects ended_at before started_at', () => {
    const m = baseManifest({ ended_at: '2025-01-01T00:00:00.000Z' });
    expect(RunManifestSchema.safeParse(m).success).toBe(false);
  });

  it('rejects an unknown outcome', () => {
    expect(RunManifestSchema.safeParse(baseManifest({ outcome: 'vibes' })).success).toBe(false);
  });

  it('rejects an unknown token usage source', () => {
    const m = baseManifest({
      token_usage: [{ source: 'daydreaming', input_tokens: 1, output_tokens: 1 }],
    });
    expect(RunManifestSchema.safeParse(m).success).toBe(false);
  });

  it('rejects negative token counts', () => {
    const m = baseManifest({
      token_usage: [{ source: 'planner', input_tokens: -1, output_tokens: 1 }],
    });
    expect(RunManifestSchema.safeParse(m).success).toBe(false);
  });
});
