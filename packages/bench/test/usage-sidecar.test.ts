import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readUsageSidecar } from '../src/usage-sidecar.js';

let dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rote-bench-usage-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

describe('readUsageSidecar', () => {
  it('accepts array and object sidecar formats', async () => {
    const dir = await tempDir();
    const arrayPath = join(dir, 'array.json');
    const objectPath = join(dir, 'object.json');
    await writeFile(arrayPath, JSON.stringify([{ source: 'planner', input_tokens: 3, output_tokens: 4 }]), 'utf8');
    await writeFile(objectPath, JSON.stringify({ token_usage: [{ source: 'slot', input_tokens: 1, output_tokens: 2 }] }), 'utf8');

    await expect(readUsageSidecar(arrayPath)).resolves.toEqual([{ source: 'planner', input_tokens: 3, output_tokens: 4 }]);
    await expect(readUsageSidecar(objectPath)).resolves.toEqual([{ source: 'slot', input_tokens: 1, output_tokens: 2 }]);
  });

  it('rejects untagged usage entries', async () => {
    const dir = await tempDir();
    const path = join(dir, 'bad.json');
    await writeFile(path, JSON.stringify([{ input_tokens: 1, output_tokens: 2 }]), 'utf8');

    await expect(readUsageSidecar(path)).rejects.toThrow();
  });
});
