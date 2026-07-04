import { buildEnvFingerprint, computeResultDigest, type RunManifest, type TokenUsage, type TrajectoryEvent } from '@rote/core';

export function manifest(runId: string, token_usage: TokenUsage[], started = '2026-01-01T00:00:00.000Z', ended = '2026-01-01T00:00:01.000Z'): RunManifest {
  return {
    run_id: runId,
    task_spec: `task ${runId}`,
    env_fingerprint: buildEnvFingerprint({
      tool_inventory: [{ name: 'browser.click', schema_hash: 'abc' }],
      target_identity: 'demo.local',
      surface_versions: {},
    }),
    outcome: 'success',
    started_at: started,
    ended_at: ended,
    token_usage,
  };
}

export function event(runId: string, seq: number): TrajectoryEvent {
  const result = { ok: true, seq };
  return {
    run_id: runId,
    seq,
    ts: '2026-01-01T00:00:00.000Z',
    tool: 'browser.click',
    args: { selector: `#s${seq}` },
    result_digest: computeResultDigest(result),
    result_ref: { kind: 'inline', value: result },
    duration_ms: 10,
  };
}
