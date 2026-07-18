import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CurveStepRecordSchema, parseCurveProtocol, parseCurveStepJsonl, renderCurveDryRun } from '../src/index.js';

describe('G1 curve protocol', () => {
  it('fixes increasing real-page task checkpoints and emits valid dry-run JSONL', async () => {
    const protocol = parseCurveProtocol(JSON.parse(await readFile(
      resolve('../../scripts/bench/curve/protocol.json'),
      'utf8',
    )));

    expect(protocol).toEqual(expect.objectContaining({
      protocol_id: 'p1-g1-wordpress-v2-openai',
      provider: 'openai',
      model: 'gpt-4.1-mini',
    }));
    expect(protocol.page.verify_command_template).toContain('{{expected_post_titles_json}}');
    expect(protocol.checkpoints.map((checkpoint) => checkpoint.target_steps)).toEqual([7, 10, 15, 20, 25]);
    const records = parseCurveStepJsonl(renderCurveDryRun(protocol));
    expect(records).toHaveLength(77);
    expect(records[0]).toEqual(expect.objectContaining({ task_id: 'WP-N07', step_index: 1, record_kind: 'dry_run' }));
    expect(records.at(-1)).toEqual(expect.objectContaining({ task_id: 'WP-N25', step_index: 25, record_kind: 'dry_run' }));
    expect(records.every((record) => record.record_kind === 'dry_run' && record.provider_usage.dry_run === true)).toBe(true);
  });

  it('retains the superseded Anthropic protocol as an immutable provenance artifact', async () => {
    const archived = parseCurveProtocol(JSON.parse(await readFile(
      resolve('../../scripts/bench/curve/protocol-v1-anthropic.json'),
      'utf8',
    )));
    expect(archived).toEqual(expect.objectContaining({
      protocol_id: 'p1-g1-wordpress-v1',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
    }));
  });

  it('rejects a checkpoint whose named work does not match its step target', () => {
    expect(() => parseCurveProtocol({
      schema_version: 1,
      protocol_id: 'invalid',
      provider: 'anthropic',
      model: 'model',
      repetitions_per_harness: 15,
      model_seed: null,
      seed_policy: 'unsupported',
      page: {
        environment: 'fixture',
        initial_url: 'http://127.0.0.1',
        reset_command: 'reset',
        verify_command_template: 'verify',
        viewport: { width: 1920, height: 1080 },
      },
      prompt_bindings: [],
      checkpoints: [
        {
          id: 'bad-1',
          target_steps: 10,
          selected_post_count: 1,
          post_titles: ['one'],
          prompt_template: 'move one',
          expected_trash_count: 1,
        },
        {
          id: 'bad-2',
          target_steps: 11,
          selected_post_count: 2,
          post_titles: ['one'],
          prompt_template: 'move two',
          expected_trash_count: 1,
        },
      ],
    })).toThrow();
  });

  it('allows actual provider calls above target interaction complexity so retries remain visible', () => {
    const zero = { input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0 };
    const record = {
      schema_version: 1,
      record_kind: 'measurement',
      protocol_id: 'p',
      task_id: 't',
      harness: 'browser-use',
      provider: 'anthropic',
      model: 'model',
      run_id: 'run',
      repetition: 1,
      target_steps: 1,
      step_index: 2,
      source: 'planner',
      duration_ms: 10,
      duration_scope: 'agent_step',
      usage: zero,
      cumulative_usage: zero,
      provider_usage: { prompt_tokens: 0, completion_tokens: 0 },
      step_outcome: 'failure',
    };
    expect(() => CurveStepRecordSchema.parse(record)).not.toThrow();
  });

  it('rejects blank JSONL rows rather than silently dropping measurements', () => {
    const zero = { input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0 };
    const valid = JSON.stringify({
      schema_version: 1,
      record_kind: 'dry_run',
      protocol_id: 'p',
      task_id: 't',
      harness: 'dry-run',
      provider: 'provider',
      model: 'model',
      run_id: 'run',
      repetition: 1,
      target_steps: 1,
      step_index: 1,
      source: 'planner',
      duration_ms: 0,
      duration_scope: 'provider_call',
      usage: zero,
      cumulative_usage: zero,
      provider_usage: { dry_run: true },
      step_outcome: 'dry_run',
    });
    expect(() => parseCurveStepJsonl(`${valid}\n\n`)).toThrow('curve JSONL line 2 is blank');
  });
});
