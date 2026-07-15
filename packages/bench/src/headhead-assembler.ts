import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { OutcomeSchema } from '@rote/core';
import { cellsFromSpec, parseBenchmarkSpec } from './spec.js';
import {
  CompetitorRunRecordSchema,
  readCompetitorRecords,
  roteRecordsFromCells,
  type CompetitorRunRecord,
} from './competitor.js';

/**
 * Assembles a head-to-head records file from *real* recorded runs.
 *
 * The subject (Rote) side reads standard `.rote/runs/<run_id>` artifacts — what
 * `rote run` already writes — through the existing benchmark spec, so the token
 * totals are summed from recorded manifests, never hand-typed. Each competitor
 * side is a sidecar the external harness emits (running Browser Use / Stagehand
 * is out-of-process; the sidecar is the fair hand-off — docs/03 "publish adapters
 * + configs + raw data", CLAUDE.md "benchmark adapters import competitors as
 * dependencies, not forks").
 */
export const HeadToHeadSubjectSchema = z.object({
  /** Path to a benchmark spec (see spec.ts) naming the recorded Rote run ids. */
  spec: z.string().min(1),
  /** Model the Rote runs used, recorded for fairness provenance. */
  model: z.string().min(1),
  /** Whether the Rote token counts are cache-adjusted (docs/03). */
  cache_adjusted: z.boolean(),
  /** Harness label; defaults to `rote`. */
  harness: z.string().min(1).default('rote'),
  config_notes: z.string().optional(),
});

export const HeadToHeadCompetitorSchema = z.object({
  harness: z.string().min(1),
  /** Path to a neutral CompetitorRunRecord file emitted by the competitor harness. */
  records: z.string().min(1),
});

export const HeadToHeadSourcesSchema = z.object({
  subject: HeadToHeadSubjectSchema,
  competitors: z.array(HeadToHeadCompetitorSchema).min(1),
});
export type HeadToHeadSources = z.infer<typeof HeadToHeadSourcesSchema>;

/**
 * Reads a sources spec and produces the merged neutral records that `buildHeadToHead`
 * / `evaluateLaunchGate` consume. Deterministic ordering: all subject records
 * first (in spec order), then each competitor's records in the order listed.
 */
export async function assembleHeadToHeadRecords(sourcesPath: string): Promise<CompetitorRunRecord[]> {
  const resolvedSources = resolve(sourcesPath);
  const sourcesDir = dirname(resolvedSources);
  const sources = HeadToHeadSourcesSchema.parse(JSON.parse(await readFile(resolvedSources, 'utf8')));

  const subjectSpecPath = resolve(sourcesDir, sources.subject.spec);
  const spec = parseBenchmarkSpec(JSON.parse(await readFile(subjectSpecPath, 'utf8')));
  const cells = await cellsFromSpec(spec, { specDir: dirname(subjectSpecPath) });
  const records: CompetitorRunRecord[] = roteRecordsFromCells(cells, {
    model: sources.subject.model,
    cacheAdjusted: sources.subject.cache_adjusted,
    harness: sources.subject.harness,
    ...(sources.subject.config_notes ? { configNotes: sources.subject.config_notes } : {}),
  });

  for (const competitor of sources.competitors) {
    const competitorRecords = await readCompetitorRecords(resolve(sourcesDir, competitor.records));
    for (const record of competitorRecords) {
      // The sidecar's `harness` must agree with how the source spec names it, so a
      // mislabeled file can never be silently ranked as the wrong competitor.
      if (record.harness !== competitor.harness) {
        throw new Error(
          `competitor records for "${competitor.harness}" contain harness "${record.harness}"`,
        );
      }
      records.push(record);
    }
  }

  return records;
}

/**
 * The generic competitor-adapter contract: the minimal per-run fields any
 * external harness can report, mapped onto a neutral record. An adapter author
 * (e.g. a Browser Use runner) emits these; the mapping to the head-to-head unit
 * lives here, in-repo and reviewable, rather than in each adapter.
 */
export const CompetitorRawRunSchema = z.object({
  task: z.string().min(1),
  outcome: OutcomeSchema,
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  duration_ms: z.number().int().nonnegative(),
  repetition: z.number().int().nonnegative().optional(),
  phase: z.enum(['cold', 'warm', 'drift']).optional(),
});
export type CompetitorRawRun = z.infer<typeof CompetitorRawRunSchema>;

const CompetitorRawRunsFileSchema = z.union([
  z.array(CompetitorRawRunSchema).min(1),
  z.object({ runs: z.array(CompetitorRawRunSchema).min(1) }),
]);

/**
 * Loads an adapter's raw per-run output (bare array or `{ runs }`), rejecting a
 * file that does not carry every field the neutral record needs — an adapter that
 * cannot report its tokens must fail here rather than contribute a silent zero.
 */
export async function readCompetitorRawRuns(path: string): Promise<CompetitorRawRun[]> {
  const parsed = CompetitorRawRunsFileSchema.parse(JSON.parse(await readFile(resolve(path), 'utf8')));
  return Array.isArray(parsed) ? parsed : parsed.runs;
}

export interface CompetitorAdapterOptions {
  harness: string;
  model: string;
  cache_adjusted: boolean;
  config_notes?: string;
}

/**
 * Maps an external harness's raw per-run output into neutral records, assigning
 * per-task repetition indices where the adapter did not supply them. Fairness
 * provenance (`model`, `cache_adjusted`, `config_notes`) is attached uniformly so
 * a competitor cannot be compared on un-adjusted counts without it showing.
 */
export function competitorRecordsFromRaw(
  runs: readonly CompetitorRawRun[],
  options: CompetitorAdapterOptions,
): CompetitorRunRecord[] {
  const nextRepByTask = new Map<string, number>();
  return z.array(CompetitorRawRunSchema).parse(runs).map((run) => {
    const rep = run.repetition ?? nextRepByTask.get(run.task) ?? 0;
    nextRepByTask.set(run.task, rep + 1);
    return CompetitorRunRecordSchema.parse({
      harness: options.harness,
      task: run.task,
      phase: run.phase ?? 'cold',
      repetition: rep,
      outcome: run.outcome,
      input_tokens: run.input_tokens,
      output_tokens: run.output_tokens,
      duration_ms: run.duration_ms,
      model: options.model,
      cache_adjusted: options.cache_adjusted,
      ...(options.config_notes ? { config_notes: options.config_notes } : {}),
    });
  });
}
