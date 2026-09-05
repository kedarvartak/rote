import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runPaths } from '@rote/recorder';
import {
  formatPredictReport,
  formatRunDetail,
  formatRunsList,
  listRuns,
  predictReport,
  reportRun,
  showRun,
} from '../../src/index.js';

// see CLAUDE.md "Errors" — never swallow an error into a boolean; a fallback
// path logs *why*. The store layer raises on a damaged artifact (#209, #216),
// which is worth nothing if the layer above it catches everything and renders
// an empty result: a corrupt run looked exactly like a run that recorded
// nothing, and a corrupt run was dropped from calibration without a word.

let baseDir: string | undefined;
afterEach(async () => { if (baseDir) await rm(baseDir, { recursive: true, force: true }); baseDir = undefined; });

const VALID_EVENT = JSON.stringify({
  run_id: 'run-1', seq: 0, ts: '2026-01-01T00:00:00.000Z', tool: 'browser.navigate',
  args: {}, result_digest: { sha256: 'a'.repeat(64), byte_length: 2, preview: '{}' },
  result_ref: { kind: 'inline', value: {} }, duration_ms: 5,
});

async function makeRun(runId: string, trajectory: string | undefined, manifest?: string): Promise<void> {
  const paths = runPaths(baseDir!, runId);
  await mkdir(paths.runDir, { recursive: true });
  if (trajectory !== undefined) await writeFile(paths.trajectoryPath, trajectory, 'utf8');
  if (manifest !== undefined) await writeFile(paths.manifestPath, manifest, 'utf8');
}

describe('invariant: a damaged artifact is never rendered as an absent one', () => {
  it('distinguishes a corrupt trajectory from a run that recorded nothing', async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'rote-corrupt-'));
    await makeRun('empty', '');
    // Not the final line: a broken *last* line is a torn write and is
    // legitimately recovered (#209). This is corruption in the middle.
    await makeRun('corrupt', `${VALID_EVENT}\n{"seq":1 "tool":"x"}\n${VALID_EVENT}\n`);

    const empty = await showRun(baseDir, 'empty');
    expect(empty.events).toEqual([]);
    expect(empty.trajectoryStatus).toEqual({ kind: 'ok' });

    const corrupt = await showRun(baseDir, 'corrupt');
    expect(corrupt.events).toEqual([]);
    expect(corrupt.trajectoryStatus.kind).toBe('unreadable');

    // ...and the difference survives rendering, which is where it matters.
    expect(formatRunDetail(empty)).toContain('events (0):');
    const rendered = formatRunDetail(corrupt);
    expect(rendered).toContain('events: UNREADABLE');
    expect(rendered).not.toContain('events (0):');
  });

  it('distinguishes an absent trajectory from an unreadable one', async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'rote-corrupt-'));
    await makeRun('in-progress', undefined);
    expect((await showRun(baseDir, 'in-progress')).trajectoryStatus).toEqual({ kind: 'absent' });
  });

  it('marks a corrupt manifest in the listing rather than calling the run in-progress', async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'rote-corrupt-'));
    await makeRun('in-progress', `${VALID_EVENT}\n`);
    await makeRun('bad-manifest', `${VALID_EVENT}\n`, '{"run_id":"bad-manifest"}');

    const listed = await listRuns(baseDir);
    expect(listed.find((run) => run.run_id === 'in-progress')?.manifestStatus).toEqual({ kind: 'absent' });
    expect(listed.find((run) => run.run_id === 'bad-manifest')?.manifestStatus.kind).toBe('unreadable');

    const rendered = formatRunsList(listed);
    expect(rendered).toContain('in-progress\t(no manifest yet)');
    expect(rendered).toContain('UNREADABLE');
  });

  it('refuses to report a run whose manifest exists and will not parse', async () => {
    // `reportRun` documents a fallback for a *manifest-less* run. A manifest
    // that is present and damaged is a different thing and must not quietly
    // take that path — the accounting would be silently incomplete.
    baseDir = await mkdtemp(join(tmpdir(), 'rote-corrupt-'));
    await makeRun('bad-manifest', `${VALID_EVENT}\n`, '{"run_id":');
    await expect(reportRun(baseDir, 'bad-manifest')).rejects.toThrow(/manifest is unreadable/);
  });

  it('still reports a genuinely manifest-less run', async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'rote-corrupt-'));
    await makeRun('no-manifest', `${VALID_EVENT}\n`);
    await expect(reportRun(baseDir, 'no-manifest')).resolves.toMatchObject({ runId: 'no-manifest' });
  });

  it('counts a run excluded from calibration instead of dropping it silently', async () => {
    // A hit rate computed over a quietly reduced sample is the wrong number
    // reported with confidence.
    baseDir = await mkdtemp(join(tmpdir(), 'rote-corrupt-'));
    await makeRun('good', `${VALID_EVENT}\n`);
    await makeRun('corrupt', `{"seq":1 "tool":"x"}\n${VALID_EVENT}\n`);

    const report = await predictReport(baseDir);
    expect(report.runs).toBe(2);
    expect(report.unreadableRuns.map((entry) => entry.runId)).toEqual(['corrupt']);
    expect(formatPredictReport(report)).toContain('excluded corrupt: trajectory unreadable');
  });

  it('reports no runs for a missing directory, and raises for one it cannot read', async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'rote-corrupt-'));
    expect(await listRuns(join(baseDir, 'nothing-here'))).toEqual([]);
    // A file where the runs directory should be is not "no runs".
    const notADirectory = join(baseDir, 'file-base');
    await mkdir(notADirectory, { recursive: true });
    await writeFile(join(notADirectory, 'runs'), 'not a directory', 'utf8');
    await expect(listRuns(notADirectory)).rejects.toThrow();
  });
});
