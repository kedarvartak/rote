import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  browserUseCurveRecordsFromRaw,
  parseBrowserUseCurveRawJsonl,
  parseCurveStepJsonl,
  writeBrowserUseCurveRecords,
} from '../src/index.js';

let dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

function rawCall(callIndex: number, overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    protocol_id: 'p1-g1-wordpress-v1',
    task_id: 'WP-N07',
    browser_use_version: '0.13.4',
    provider: 'anthropic',
    model: 'claude-opus-4-8',
    run_id: 'browser-use-WP-N07-r01',
    repetition: 1,
    target_steps: 7,
    call_index: callIndex,
    agent_step_index: callIndex,
    agent_step_duration_ms: 1250,
    provider_usage: {
      prompt_tokens: 1000,
      completion_tokens: 40,
      prompt_cached_tokens: 600,
      prompt_cache_creation_tokens: 100,
      total_tokens: 1040,
    },
    step_outcome: 'continued',
    ...overrides,
  };
}

describe('Browser Use G1 provider receipts', () => {
  it('normalizes cache buckets, preserves the raw receipt, and accumulates every call', () => {
    const calls = parseBrowserUseCurveRawJsonl(`${JSON.stringify(rawCall(1))}\n${JSON.stringify(rawCall(2, {
      step_outcome: 'success',
      verification_passed: true,
      agent_concluded: true,
      action_kind: 'done',
    }))}\n`);
    const records = browserUseCurveRecordsFromRaw(calls);

    expect(records[0]).toEqual(expect.objectContaining({
      harness: 'browser-use',
      harness_version: '0.13.4',
      step_index: 1,
      agent_step_index: 1,
      duration_ms: 1250,
      duration_scope: 'agent_step',
      usage: { input_tokens: 400, cache_read_tokens: 600, cache_write_tokens: 100, output_tokens: 40 },
      cumulative_usage: { input_tokens: 400, cache_read_tokens: 600, cache_write_tokens: 100, output_tokens: 40 },
      provider_usage: expect.objectContaining({ prompt_tokens: 1000, total_tokens: 1040 }),
    }));
    expect(records[1]).toEqual(expect.objectContaining({
      step_outcome: 'success',
      verification_passed: true,
      cumulative_usage: { input_tokens: 800, cache_read_tokens: 1200, cache_write_tokens: 200, output_tokens: 80 },
    }));
  });

  it('fails instead of fabricating uncached usage from an impossible provider receipt', () => {
    const calls = parseBrowserUseCurveRawJsonl(`${JSON.stringify(rawCall(1, {
      provider_usage: { prompt_tokens: 10, completion_tokens: 2, prompt_cached_tokens: 11 },
      step_outcome: 'failure',
      verification_passed: false,
      agent_concluded: false,
    }))}\n`);
    expect(() => browserUseCurveRecordsFromRaw(calls)).toThrow('cache reads above prompt tokens');
  });

  it('writes JSONL that round-trips through the shared curve schema', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rote-browser-use-curve-'));
    dirs.push(dir);
    const rawPath = join(dir, 'raw.jsonl');
    const outPath = join(dir, 'records.jsonl');
    await writeFile(rawPath, `${JSON.stringify(rawCall(1, { step_outcome: 'success', verification_passed: true, agent_concluded: true }))}\n`);

    await expect(writeBrowserUseCurveRecords(rawPath, outPath)).resolves.toBe(1);
    const records = parseCurveStepJsonl(await readFile(outPath, 'utf8'));
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(expect.objectContaining({ record_kind: 'measurement', step_outcome: 'success' }));
  });

  it('rejects missing provider calls in a run rather than drawing a discontinuous curve', () => {
    expect(() => parseBrowserUseCurveRawJsonl(
      `${JSON.stringify(rawCall(1))}\n${JSON.stringify(rawCall(3))}\n`,
    )).toThrow('expected provider call 2, got 3');
  });
});
