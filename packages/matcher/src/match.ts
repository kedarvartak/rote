import { z } from 'zod';
import { EnvFingerprintSchema, PlaybookSchema, type EnvFingerprint, type ParamBindings, type Playbook } from '@rote/core';

// see docs/02-architecture.md "Matcher" and CLAUDE.md invariant 3 — matching is
// two stages in a fixed order. Stage 1 is the environment fingerprint hard gate:
// a candidate recorded on another environment is discarded before any semantic
// comparison runs, so no similarity score can ever argue a staging playbook onto
// prod. Stage 2 is deterministic: the task text with the caller's param values
// slotted out is compared to the playbook's templated intent, every declared
// param must bind, and the score must clear a conservative threshold with a
// clear winner (docs/03-benchmark.md T4: any false replay is a design kill, so
// the matcher prefers misses). v1 makes no model call; a later semantic stage
// must go through the tagged LLM client as `matcher`.

/** One playbook the matcher may select, with the environment it was proved on. */
export const PlaybookLibraryEntrySchema = z.object({
  playbook: PlaybookSchema,
  /** `EnvFingerprint.fingerprint_hash` of the run the playbook was recorded/proved on — the stage-1 gate compares against it. */
  fingerprint_hash: z.string().length(64),
  /** Where the YAML lives, for the caller; opaque to matching. */
  playbook_path: z.string().min(1).optional(),
  source_run_id: z.string().min(1).optional(),
});
export type PlaybookLibraryEntry = z.infer<typeof PlaybookLibraryEntrySchema>;

export interface MatchRequest {
  task: string;
  params: ParamBindings;
  envFingerprint: EnvFingerprint;
  candidates: readonly PlaybookLibraryEntry[];
  /** Minimum intent score to match; default 0.8 (conservative — prefer misses). */
  threshold?: number;
  /** Two distinct playbooks scoring within this margin of each other is ambiguity, not a match; default 0.05. */
  ambiguityMargin?: number;
}

export type NoMatchReason = 'no_candidates' | 'fingerprint_mismatch' | 'params_unbound' | 'below_threshold' | 'ambiguous';

export interface ScoredCandidate {
  entry: PlaybookLibraryEntry;
  score: number;
  /** Declared params that could not be bound from the request; non-empty disqualifies. */
  unbound: string[];
}

export type MatchResult =
  | { kind: 'match'; entry: PlaybookLibraryEntry; score: number; bindings: ParamBindings; considered: number }
  | { kind: 'no_match'; reason: NoMatchReason; considered: number; best?: ScoredCandidate };

const DEFAULT_THRESHOLD = 0.8;
const DEFAULT_MARGIN = 0.05;
/** Params the CLI rebinds from the live URL after the fingerprint gate; never a match criterion. */
const REBOUND_PARAMS = new Set(['base_url', 'initial_url']);

/**
 * Selects at most one playbook for a task. Deterministic; no I/O, no clock, no model.
 * Order: fingerprint hard gate → param binding → intent score → threshold → uniqueness.
 */
export function matchPlaybook(request: MatchRequest): MatchResult {
  const fingerprint = EnvFingerprintSchema.parse(request.envFingerprint);
  const threshold = request.threshold ?? DEFAULT_THRESHOLD;
  const margin = request.ambiguityMargin ?? DEFAULT_MARGIN;
  if (request.candidates.length === 0) return { kind: 'no_match', reason: 'no_candidates', considered: 0 };

  // INVARIANT (never cross environments): stage 1 discards before stage 2 sees the candidate.
  const sameEnvironment = request.candidates.filter((entry) => PlaybookLibraryEntrySchema.parse(entry).fingerprint_hash === fingerprint.fingerprint_hash);
  if (sameEnvironment.length === 0) return { kind: 'no_match', reason: 'fingerprint_mismatch', considered: request.candidates.length };

  const scored: ScoredCandidate[] = sameEnvironment.map((entry) => ({
    entry,
    score: intentScore(request.task, request.params, entry.playbook),
    unbound: unboundParams(entry.playbook, request.params),
  }));
  scored.sort((a, b) => b.score - a.score || b.entry.playbook.version - a.entry.playbook.version || a.entry.playbook.playbook.localeCompare(b.entry.playbook.playbook));
  const bindable = scored.filter((candidate) => candidate.unbound.length === 0);
  const best = scored[0]!;
  if (bindable.length === 0) return { kind: 'no_match', reason: 'params_unbound', considered: request.candidates.length, best };
  const top = bindable[0]!;
  if (top.score < threshold) return { kind: 'no_match', reason: 'below_threshold', considered: request.candidates.length, best: top };
  // Prefer misses: a runner-up *different* playbook within the margin means the
  // task text does not single one procedure out. Versions of the same playbook
  // are not rivals — the newest already sorted first.
  const rival = bindable.find((candidate) => candidate !== top && candidate.entry.playbook.playbook !== top.entry.playbook.playbook && top.score - candidate.score < margin);
  if (rival) return { kind: 'no_match', reason: 'ambiguous', considered: request.candidates.length, best: top };
  return { kind: 'match', entry: top.entry, score: top.score, bindings: bindingsFor(top.entry.playbook, request.params), considered: request.candidates.length };
}

/**
 * Intent score in [0, 1]. Two conditions, both about preferring misses:
 * - **coverage**: every content token of the playbook's intent (slots and stopwords
 *   aside) must appear in the task — a playbook does what its intent says, and a
 *   task that does not mention "registration" gives no licence to run a registration
 *   procedure, however long and similar the rest of the sentence is (docs/03 B6:
 *   "deregistration" must miss even at Jaccard 0.82);
 * - **Jaccard** over all tokens between the task (with every provided param value
 *   replaced by its `{{name}}` slot) and the intent, so extra material in the task
 *   (", then delete the vendor") still lowers the score below the threshold.
 * Slotting values out first means "Register Acme Tools as a vendor" scores 1.0
 * against "Register {{company_name}} as a vendor".
 */
export function intentScore(task: string, params: ParamBindings, playbook: Playbook): number {
  const slotted = slotValues(task, params);
  const a = tokens(slotted);
  const b = tokens(playbook.task_signature.intent_description);
  if (a.size === 0 || b.size === 0) return 0;
  for (const token of b) if (isContentToken(token) && !a.has(token)) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

/** Function words a task may drop or add without changing what procedure it asks for. */
const STOPWORDS = new Set(['a', 'an', 'the', 'as', 'with', 'to', 'of', 'for', 'and', 'then', 'in', 'on', 'into', 'at', 'by', 'from', 'this', 'that', 'it', 'its', 'please']);

function isContentToken(token: string): boolean {
  return !token.startsWith('{{') && !STOPWORDS.has(token);
}

function slotValues(text: string, params: ParamBindings): string {
  let out = text;
  const entries = Object.entries(params)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)
    .sort((x, y) => y[1].length - x[1].length);
  for (const [name, value] of entries) out = out.split(value).join(` {{${name}}} `);
  return out;
}

function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/g, ' {{$1}} ').split(/[^a-z0-9_{}]+/).filter((token) => token.length > 0));
}

function unboundParams(playbook: Playbook, params: ParamBindings): string[] {
  return playbook.params.filter((param) => !REBOUND_PARAMS.has(param.name) && !bindable(param.type, params[param.name])).map((param) => param.name);
}

function bindable(type: 'string' | 'number' | 'boolean' | 'money', value: unknown): boolean {
  if (type === 'string') return typeof value === 'string' && value.length > 0;
  if (type === 'boolean') return typeof value === 'boolean';
  return typeof value === 'number' && Number.isFinite(value);
}

function bindingsFor(playbook: Playbook, params: ParamBindings): ParamBindings {
  const out: ParamBindings = {};
  for (const param of playbook.params) if (params[param.name] !== undefined) out[param.name] = params[param.name]!;
  return out;
}
