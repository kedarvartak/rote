import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { SiteMemoryRecordSchema, parseJsonl, type SiteMemoryRecord } from '@rote/core';

// see docs/02-architecture.md "Tiers 1 and 2 — the learning plane" — site memory
// is append-only JSONL partitioned by environment fingerprint hash. Reads never
// cross a partition (invariant 3: never cross environments), writes never edit a
// line (invariant 4: everything versioned), and a write cut short leaves a fragment
// the next read skips and the next write starts after.

/** Where one environment's site memory lives under a base directory. */
export function siteMemoryLogPath(baseDir: string, fingerprintHash: string): string {
  return join(baseDir, 'site-memory', encodeURIComponent(fingerprintHash), 'records.jsonl');
}

/** Raised when a record is appended to a partition other than its own fingerprint. */
export class SiteMemoryPartitionError extends Error {
  constructor(readonly expected: string, readonly got: string) {
    super(`site memory record belongs to fingerprint ${got}, not ${expected}`);
    this.name = 'SiteMemoryPartitionError';
  }
}

/** Minimal store contract so tests can use an in-memory double. */
export interface SiteMemoryStore {
  /** Every complete record for one environment, in write order. */
  read(fingerprintHash: string): Promise<SiteMemoryRecord[]>;
  /** Appends records to their own partition; a record for another fingerprint is refused. */
  append(fingerprintHash: string, records: readonly SiteMemoryRecord[]): Promise<void>;
}

/** Append-only, per-fingerprint site memory log with crash-tolerant reads. */
export class FileSiteMemoryStore implements SiteMemoryStore {
  constructor(private readonly baseDir: string) {}

  async read(fingerprintHash: string): Promise<SiteMemoryRecord[]> {
    let text: string;
    try {
      text = await readFile(siteMemoryLogPath(this.baseDir, fingerprintHash), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const records: SiteMemoryRecord[] = [];
    // A crash mid-append leaves an incomplete final line, which is dropped;
    // anything else unparsable is corruption and raises (see `parseJsonl`).
    for (const parsed of parseJsonl(text, { tornFragments: 'anywhere' }).values) {
      const record = SiteMemoryRecordSchema.parse(parsed);
      // INVARIANT: a partition holds only its own environment's records.
      if (record.fingerprint_hash !== fingerprintHash) throw new SiteMemoryPartitionError(fingerprintHash, record.fingerprint_hash);
      records.push(record);
    }
    return records;
  }

  async append(fingerprintHash: string, records: readonly SiteMemoryRecord[]): Promise<void> {
    const parsed = records.map((record) => SiteMemoryRecordSchema.parse(record));
    for (const record of parsed) if (record.fingerprint_hash !== fingerprintHash) throw new SiteMemoryPartitionError(fingerprintHash, record.fingerprint_hash);
    if (parsed.length === 0) return;
    const path = siteMemoryLogPath(this.baseDir, fingerprintHash);
    await mkdir(dirname(path), { recursive: true });
    const needsNewline = await endsWithoutNewline(path);
    await appendFile(path, `${needsNewline ? '\n' : ''}${parsed.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
  }
}

async function endsWithoutNewline(path: string): Promise<boolean> {
  try {
    const text = await readFile(path, 'utf8');
    return text.length > 0 && !text.endsWith('\n');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** In-memory store for tests and dry runs; same partition discipline as the file store. */
export class MemorySiteMemoryStore implements SiteMemoryStore {
  readonly partitions = new Map<string, SiteMemoryRecord[]>();
  async read(fingerprintHash: string): Promise<SiteMemoryRecord[]> {
    return [...(this.partitions.get(fingerprintHash) ?? [])];
  }
  async append(fingerprintHash: string, records: readonly SiteMemoryRecord[]): Promise<void> {
    const parsed = records.map((record) => SiteMemoryRecordSchema.parse(record));
    for (const record of parsed) if (record.fingerprint_hash !== fingerprintHash) throw new SiteMemoryPartitionError(fingerprintHash, record.fingerprint_hash);
    this.partitions.set(fingerprintHash, [...(this.partitions.get(fingerprintHash) ?? []), ...parsed]);
  }
}
