import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { parsePlaybookYaml, writePlaybookYaml, type Playbook } from '@rote/core';
import { PlaybookLibraryEntrySchema, type PlaybookLibraryEntry } from './match.js';

// CLAUDE.md invariant 4 — the library is append-only: each playbook version is
// its own YAML file written exclusively (never overwritten), and the index is a
// JSONL log; a truncated tail is skipped and never edited, a complete-but-invalid
// line is corruption and throws.

/** One line of the library index; the YAML file is the playbook itself. */
export const PlaybookLibraryIndexRecordSchema = z.object({
  version: z.literal(1),
  playbook: z.string().min(1),
  playbook_version: z.number().int().positive(),
  playbook_path: z.string().min(1),
  fingerprint_hash: z.string().length(64),
  source_run_id: z.string().min(1).optional(),
  added_at: z.string().datetime(),
}).strict();
export type PlaybookLibraryIndexRecord = z.infer<typeof PlaybookLibraryIndexRecordSchema>;

export function playbookLibraryIndexPath(baseDir: string): string {
  return join(baseDir, 'playbooks', 'library.jsonl');
}

/** Raised when a playbook name+version already exists in the library — versions are immutable. */
export class PlaybookVersionExistsError extends Error {
  constructor(readonly playbook: string, readonly version: number) {
    super(`playbook ${playbook} v${version} already exists in the library; bump the version instead of rewriting`);
    this.name = 'PlaybookVersionExistsError';
  }
}

export interface AddPlaybookInput {
  playbook: Playbook;
  fingerprintHash: string;
  sourceRunId?: string;
  addedAt: Date;
}

/** Append-only playbook library on the filesystem: `playbooks/<name>-v<version>.yaml` + `playbooks/library.jsonl`. */
export class FilePlaybookLibrary {
  constructor(private readonly baseDir: string) {}

  /** Adds one playbook version exclusively; throws if that version is already present. */
  async add(input: AddPlaybookInput): Promise<PlaybookLibraryEntry> {
    const dir = join(this.baseDir, 'playbooks');
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${encodeURIComponent(input.playbook.playbook)}-v${input.playbook.version}.yaml`);
    try {
      // `wx`: a version, once written, is never rewritten in place.
      await writeFile(path, writePlaybookYaml(input.playbook), { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new PlaybookVersionExistsError(input.playbook.playbook, input.playbook.version);
      throw error;
    }
    const record = PlaybookLibraryIndexRecordSchema.parse({
      version: 1,
      playbook: input.playbook.playbook,
      playbook_version: input.playbook.version,
      playbook_path: relative(this.baseDir, path),
      fingerprint_hash: input.fingerprintHash,
      ...(input.sourceRunId ? { source_run_id: input.sourceRunId } : {}),
      added_at: input.addedAt.toISOString(),
    });
    const indexPath = playbookLibraryIndexPath(this.baseDir);
    const needsNewline = await endsWithoutNewline(indexPath);
    await appendFile(indexPath, `${needsNewline ? '\n' : ''}${JSON.stringify(record)}\n`, 'utf8');
    return { playbook: input.playbook, fingerprint_hash: input.fingerprintHash, playbook_path: path, ...(input.sourceRunId ? { source_run_id: input.sourceRunId } : {}) };
  }

  /** Every playbook in the index, in add order, with its YAML parsed. */
  async list(): Promise<PlaybookLibraryEntry[]> {
    let text: string;
    try {
      text = await readFile(playbookLibraryIndexPath(this.baseDir), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const entries: PlaybookLibraryEntry[] = [];
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        if (!line.trimEnd().endsWith('}')) continue; // truncated append: recoverable, never edited
        throw error;
      }
      const record = PlaybookLibraryIndexRecordSchema.parse(parsed);
      const path = resolve(this.baseDir, record.playbook_path);
      const playbook = parsePlaybookYaml(await readFile(path, 'utf8'));
      entries.push(PlaybookLibraryEntrySchema.parse({ playbook, fingerprint_hash: record.fingerprint_hash, playbook_path: path, ...(record.source_run_id ? { source_run_id: record.source_run_id } : {}) }));
    }
    return entries;
  }
}

async function endsWithoutNewline(path: string): Promise<boolean> {
  try {
    const text = await readFile(path, 'utf8');
    return text.length > 0 && !text.endsWith('\n');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') { await mkdir(dirname(path), { recursive: true }); return false; }
    throw error;
  }
}
