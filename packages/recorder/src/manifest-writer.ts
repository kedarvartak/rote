import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { RunManifest } from '@rote/core';

/**
 * Writes the RunManifest once, at session end. Unlike the trajectory JSONL
 * (append-per-event), the manifest is a single snapshot written after every
 * queued trajectory write has drained — see proxy.ts's use of
 * SequentialQueue#drain() before calling this.
 */
export async function writeRunManifest(path: string, manifest: RunManifest): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}
