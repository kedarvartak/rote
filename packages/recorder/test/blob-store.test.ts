import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeBlob } from '../src/blob-store.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rote-recorder-blob-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('writeBlob', () => {
  it('writes the exact contents to the given path, creating parent dirs', async () => {
    const path = join(dir, 'blobs', 'deadbeef.json');
    await writeBlob(path, JSON.stringify({ data: 'x'.repeat(100) }));
    const text = await readFile(path, 'utf8');
    expect(JSON.parse(text)).toEqual({ data: 'x'.repeat(100) });
  });

  it('overwriting the same content-addressed path with identical bytes is harmless', async () => {
    const path = join(dir, 'same.json');
    await writeBlob(path, '{"a":1}');
    await writeBlob(path, '{"a":1}');
    expect(await readFile(path, 'utf8')).toBe('{"a":1}');
  });
});
