import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Writes a content-addressed blob. Paths are keyed by SHA-256 of the
 * content (see build-trajectory-event.ts), so a second write for the same
 * content is a harmless overwrite of identical bytes — no existence check
 * needed for correctness, only for the (unclaimed, v2+) optimization of
 * skipping the write entirely.
 */
export async function writeBlob(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, 'utf8');
}
