import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { TaskCheckpointSchema, parseJsonl, type TaskCheckpoint } from '@rote/core';

// see docs/05-roadmap.md P2 item 9 (#133) — checkpoints are append-only JSONL per
// task. Recovery after an interrupted write uses the last *complete* line; nothing
// is ever rewritten in place (CLAUDE.md invariant 4).

/** Where one task's checkpoint log lives under a base directory. */
export function checkpointLogPath(baseDir: string, taskId: string): string {
  return join(baseDir, 'continuations', encodeURIComponent(taskId), 'checkpoints.jsonl');
}

/** Raised when a checkpoint append would break the per-task sequence (concurrent writers, replayed log). */
export class CheckpointSequenceError extends Error {
  constructor(readonly taskId: string, readonly expectedSeq: number, readonly gotSeq: number) {
    super(`checkpoint for task ${taskId} must have seq ${expectedSeq}, got ${gotSeq}`);
    this.name = 'CheckpointSequenceError';
  }
}

/** Minimal store contract so tests can use an in-memory double. */
export interface CheckpointStore {
  latest(taskId: string): Promise<TaskCheckpoint | undefined>;
  append(checkpoint: TaskCheckpoint): Promise<void>;
}

/** Append-only, per-task checkpoint log with crash-tolerant reads. */
export class FileCheckpointStore implements CheckpointStore {
  constructor(private readonly baseDir: string) {}

  /** Returns the last complete checkpoint for a task, or undefined; a trailing partial line is ignored. */
  async latest(taskId: string): Promise<TaskCheckpoint | undefined> {
    const all = await this.readAll(taskId);
    return all[all.length - 1];
  }

  /** Every complete checkpoint in write order. */
  async readAll(taskId: string): Promise<TaskCheckpoint[]> {
    let text: string;
    try {
      text = await readFile(checkpointLogPath(this.baseDir, taskId), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const checkpoints: TaskCheckpoint[] = [];
    // A write cut short leaves a syntactically incomplete final line; that is
    // recoverable and the previous complete checkpoint stays authoritative. Any
    // other unparsable line is corruption and must surface rather than be
    // skipped — the rule, and the reason the last byte is not the test, is in
    // `parseJsonl`.
    for (const parsed of parseJsonl(text, { tornFragments: 'anywhere' }).values) {
      checkpoints.push(TaskCheckpointSchema.parse(parsed));
    }
    return checkpoints;
  }

  /** Appends one checkpoint; seq must be exactly latest+1 (or 0 for a new task). */
  async append(checkpoint: TaskCheckpoint): Promise<void> {
    const parsed = TaskCheckpointSchema.parse(checkpoint);
    const previous = await this.latest(parsed.task_id);
    const expectedSeq = previous ? previous.seq + 1 : 0;
    if (parsed.seq !== expectedSeq) throw new CheckpointSequenceError(parsed.task_id, expectedSeq, parsed.seq);
    const path = checkpointLogPath(this.baseDir, parsed.task_id);
    await mkdir(dirname(path), { recursive: true });
    // One JSON line per append; a crash mid-write leaves a truncated fragment that
    // `readAll` skips, so the previous checkpoint stays authoritative. A fragment
    // is never edited: the next record starts on its own line after it.
    const needsNewline = await endsWithoutNewline(path);
    await appendFile(path, `${needsNewline ? '\n' : ''}${JSON.stringify(parsed)}\n`, 'utf8');
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

/** In-memory store for tests and dry runs; same sequence discipline as the file store. */
export class MemoryCheckpointStore implements CheckpointStore {
  readonly logs = new Map<string, TaskCheckpoint[]>();
  async latest(taskId: string): Promise<TaskCheckpoint | undefined> {
    const log = this.logs.get(taskId) ?? [];
    return log[log.length - 1];
  }
  async append(checkpoint: TaskCheckpoint): Promise<void> {
    const parsed = TaskCheckpointSchema.parse(checkpoint);
    const log = this.logs.get(parsed.task_id) ?? [];
    const expectedSeq = log.length === 0 ? 0 : log[log.length - 1]!.seq + 1;
    if (parsed.seq !== expectedSeq) throw new CheckpointSequenceError(parsed.task_id, expectedSeq, parsed.seq);
    log.push(parsed);
    this.logs.set(parsed.task_id, log);
  }
}
