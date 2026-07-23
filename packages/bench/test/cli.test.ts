import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeTrajectoryJsonl } from '@rote/core';
import { runPaths } from '@rote/recorder';
import { main } from '../src/cli.js';
import { event, manifest } from './helpers.js';

let dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rote-bench-cli-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

describe('rote-bench CLI', () => {
  it('validates the curve protocol and writes non-evidentiary dry-run JSONL', async () => {
    const root = await tempDir();
    const outPath = join(root, 'curve-dry-run.jsonl');
    const protocolPath = resolve('../../scripts/bench/curve/protocol.json');

    await expect(main(['curve-dry-run', protocolPath, '--out', outPath])).resolves.toBe(
      `wrote ${outPath} (85 dry-run step records)`,
    );
    const lines = (await readFile(outPath, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(85);
    expect(JSON.parse(lines[0]!)).toEqual(expect.objectContaining({ record_kind: 'dry_run', task_id: 'WP-N09' }));
  });

  it('writes a reproducible cache preflight from curve measurement rows', async () => {
    const root = await tempDir();
    const outPath = join(root, 'cache-preflight.json');
    const recordsPath = resolve('../../docs/testing/data/T3-rote-openai-exploratory.jsonl');

    await expect(main(['curve-cache-preflight', recordsPath, '--out', outPath, '--threshold', '1024'])).resolves.toBe(
      `wrote ${outPath} (2/86 calls hit cache; go-layout-work)`,
    );
    await expect(readFile(outPath, 'utf8')).resolves.toContain('"layout_qualified": false');
  });

  it('converts raw Browser Use receipts into validated curve measurement JSONL', async () => {
    const root = await tempDir();
    const rawPath = join(root, 'raw-calls.jsonl');
    const outPath = join(root, 'browser-use-curve.jsonl');
    await writeFile(rawPath, `${JSON.stringify({
      schema_version: 1,
      protocol_id: 'p1-g1-wordpress-v1',
      task_id: 'WP-N07',
      browser_use_version: '0.13.4',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      run_id: 'browser-use-WP-N07-r01',
      repetition: 1,
      target_steps: 7,
      call_index: 1,
      agent_step_index: 1,
      agent_step_duration_ms: 1250,
      provider_usage: { prompt_tokens: 1000, completion_tokens: 40, prompt_cached_tokens: 600 },
      step_outcome: 'success',
      verification_passed: true,
      agent_concluded: true,
    })}\n`, 'utf8');

    await expect(main(['curve-browser-use-records', rawPath, '--out', outPath])).resolves.toBe(
      `wrote ${outPath} (1 Browser Use measurement records)`,
    );
    const record = JSON.parse((await readFile(outPath, 'utf8')).trim());
    expect(record).toEqual(expect.objectContaining({
      record_kind: 'measurement',
      usage: { input_tokens: 400, cache_read_tokens: 600, cache_write_tokens: 0, output_tokens: 40 },
    }));
  });

  it('writes a synthetic benchmark pack and evaluates the M3 gate', async () => {
    const root = await tempDir();
    const specPath = join(root, 'bench-spec.json');

    await expect(main(['synthetic', root])).resolves.toBe(`wrote synthetic benchmark pack: ${specPath} and ${join(root, 'report.md')}`);
    await expect(readFile(join(root, 'report.md'), 'utf8')).resolves.toContain('| B1 | 200000 | 18000 | 91.0% | 40 | 6 | 85.0% |');
    await expect(main(['gate', specPath])).resolves.toContain('M3 gate: PASS');
    await expect(main(['gate', specPath, '--min-token-reduction', '0.95'])).rejects.toThrow('M3 gate: FAIL');
  });

  it('reports and gates serializer parity from captured Browser Use observations', async () => {
    const root = await tempDir();
    const htmlPath = join(root, 'page.html');
    const baselinePath = join(root, 'browser-use.txt');
    const specPath = join(root, 'serializer-spec.json');
    const reportPath = join(root, 'serializer-report.md');
    await writeFile(htmlPath, '<label for="query">Search</label><input id="query" />', 'utf8');
    await writeFile(baselinePath, 'browser use observation '.repeat(20), 'utf8');
    await writeFile(specPath, JSON.stringify({
      fixtures: [{ id: 'B3', html_path: 'page.html', browser_use_observation_path: 'browser-use.txt' }],
    }), 'utf8');

    await expect(main(['serializer-report', specPath, '--out', reportPath])).resolves.toBe(`wrote ${reportPath}`);
    await expect(readFile(reportPath, 'utf8')).resolves.toContain('Overall: PASS');
    await expect(main(['serializer-gate', specPath])).resolves.toContain('Overall: PASS');

    await writeFile(baselinePath, 'x', 'utf8');
    await expect(main(['serializer-gate', specPath])).rejects.toThrow('serializer parity gate failed: B3');
  });

  it('writes a report and raw JSONL export from a benchmark spec', async () => {
    const root = await tempDir();
    const baseDir = join(root, '.rote');
    const reportPath = join(root, 'report.md');
    const exportDir = join(root, 'raw');
    const specPath = join(root, 'spec.json');
    const usagePath = join(root, 'usage.json');
    const paths = runPaths(baseDir, 'cold-1');
    await mkdir(dirname(paths.manifestPath), { recursive: true });
    await writeFile(paths.manifestPath, `${JSON.stringify(manifest('cold-1', []))}\n`, 'utf8');
    await writeFile(paths.trajectoryPath, writeTrajectoryJsonl([event('cold-1', 0)]), 'utf8');
    await writeFile(usagePath, JSON.stringify([{ source: 'planner', input_tokens: 10, output_tokens: 5 }]), 'utf8');
    await writeFile(
      specPath,
      JSON.stringify({
        base_dir: baseDir,
        runs: [{ task: { id: 'B1', name: 'one' }, phase: 'cold', repetition: 1, run_id: 'cold-1', usage_file: 'usage.json' }],
      }),
      'utf8',
    );

    await expect(main(['report', specPath, '--out', reportPath, '--export-jsonl', exportDir])).resolves.toBe(
      `wrote ${reportPath} and ${join(exportDir, '<run_id>.jsonl')}`,
    );
    await expect(readFile(reportPath, 'utf8')).resolves.toContain('| B1 | cold | 1 | 1 | 0 | 15 | 1 | 1000 |');
    await expect(readFile(join(exportDir, 'cold-1.jsonl'), 'utf8')).resolves.toBe(writeTrajectoryJsonl([event('cold-1', 0)]));
  });
});
