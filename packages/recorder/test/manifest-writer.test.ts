import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RunManifestSchema, type RunManifest } from '@rote/core';
import { writeRunManifest } from '../src/manifest-writer.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rote-recorder-manifest-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const manifest: RunManifest = {
  run_id: 'run-1',
  task_spec: 'B1: download report',
  env_fingerprint: {
    tool_inventory: [],
    target_identity: 'demo.example.com',
    surface_versions: {},
    fingerprint_hash: 'a'.repeat(64),
  },
  outcome: 'success',
  started_at: '2026-01-01T00:00:00.000Z',
  ended_at: '2026-01-01T00:00:05.000Z',
  token_usage: [],
};

describe('writeRunManifest', () => {
  it('writes a manifest that re-parses as valid', async () => {
    const path = join(dir, 'manifest.json');
    await writeRunManifest(path, manifest);
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    expect(RunManifestSchema.parse(parsed)).toEqual(manifest);
  });

  it('creates parent directories as needed', async () => {
    const path = join(dir, 'runs', 'run-1', 'manifest.json');
    await writeRunManifest(path, manifest);
    await expect(readFile(path, 'utf8')).resolves.toBeTruthy();
  });
});
