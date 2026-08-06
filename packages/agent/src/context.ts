import type { AdaptiveObservationMode } from '@rote/perception';
import { buildPlannerActionHistory, type HistoryCompactionPolicy } from './history-compaction.js';
import type { BrowserAction, BrowserExpectFailure, PlannerContext } from './types.js';

const ACTION_SCHEMA = `Actions (return exactly one JSON object):
- {"kind":"navigate","url":"https://...","expect":{"url_contains":"/expected"}}
- {"kind":"fill","selector":"#id","stableId":"0123456789abcdef","role":"textbox","name":"Field name","value":"text"}
- {"kind":"select","selector":"#id","stableId":"0123456789abcdef","role":"combobox","name":"Field name","value":"option-value"}
- {"kind":"click","selector":"#id","stableId":"0123456789abcdef","role":"button","name":"Button text","text":"Button text"}
- {"kind":"done","success":true|false,"summary":"result"}`;

// see #49 — the schema examples above deliberately omit `expect` on fill/select/click.
// A model-authored postcondition can only assert what the model has already seen, so
// asking for one about a future page state yields a guess (fatal when wrong) or a
// tautology (worthless when right). The guidance below asks for omission instead of a
// guess, and names the two failure shapes we actually measured on T1.
const EXPECT_GUIDANCE = `"expect" is optional — omit it unless the observation you can see right now already
proves it. Never guess confirmation wording or selectors you have not seen, and never
assert a value you just typed or text already on screen. Completion is checked
independently at the end, so omitting "expect" is safe and preferred over guessing.`;

/** Raised when volatile data would invalidate the planner's provider-cache prefix. */
export class CacheLayoutImmutabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CacheLayoutImmutabilityError';
  }
}

/** Stable and volatile inputs used to assemble one planner request. */
export interface AssemblePlannerContextOptions {
  task: string;
  page: { url: string; title: string };
  observation: string;
  observationMode: AdaptiveObservationMode;
  previousActions: readonly BrowserAction[];
  /** B4 schedule; `false` reproduces the unbounded action-history baseline. */
  historyCompactionPolicy?: HistoryCompactionPolicy | false;
  /** Compact current control state retained even when unchanged nodes are diff-evicted. */
  stateSummary?: string;
  /** Prior observation content is no longer available in this stateless planner request. */
  observationHistoryEvicted?: boolean;
  /** Set on a scoped repair call; rendered into the volatile suffix only. */
  repair?: BrowserExpectFailure;
}

/** Builds a cache-stable planner prefix and a per-step volatile suffix. */
export function assemblePlannerContext(options: AssemblePlannerContextOptions): PlannerContext {
  assertKnownLayoutFields(options);
  // see docs/02-architecture.md "Decision plane details" — stable material
  // stays before per-step state so provider prompt caches survive observation changes.
  const stablePrefix = `You are Rote's browser planner.
Choose one safe next action that advances the task. Use only selectors present in the observation.
For multi-select work, compare Current stateful controls against every requested item before applying a bulk action; never infer that an unchecked item was selected.
Return JSON only; do not wrap it in markdown.

Task:
${options.task}

${ACTION_SCHEMA}

${EXPECT_GUIDANCE}`;
  const history = buildPlannerActionHistory(
    options.previousActions,
    options.historyCompactionPolicy,
  );
  // see docs/02-architecture.md "Caching and compaction fight" — exact recent
  // history stays append-only between explicit compaction boundaries.
  const volatileSuffix = `Previous actions:
${history.text}

Current page:
${options.page.title} | ${options.page.url}
${renderRecallBoundary(options.observationHistoryEvicted, history.compaction?.detailsEvicted)}
Current stateful controls:
${options.stateSummary ?? '(none)'}
${renderRepair(options.repair)}
Compact observation (${options.observationMode}):
${options.observation}`;
  return { stablePrefix, volatileSuffix, history };
}

/** Fails if a planner prefix mutates after the first step of a run. */
export function assertCacheStablePrefix(expected: string | undefined, actual: string): string {
  if (expected !== undefined && expected !== actual) {
    // INVARIANT: changing bytes above the stable/volatile line silently destroys
    // provider cache locality while leaving correctness tests green.
    throw new CacheLayoutImmutabilityError('planner stable prefix changed within one run');
  }
  return expected ?? actual;
}

function assertKnownLayoutFields(options: AssemblePlannerContextOptions): void {
  const allowed = new Set(['task', 'page', 'observation', 'observationMode', 'previousActions', 'historyCompactionPolicy', 'stateSummary', 'observationHistoryEvicted', 'repair']);
  const unknown = Object.keys(options).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new CacheLayoutImmutabilityError(
      `unknown planner context fields could cross the cache-stability boundary: ${unknown.join(', ')}`,
    );
  }
}

/**
 * Renders the scoped-repair note for the volatile suffix (docs/02 "Repair ladder").
 *
 * The wording carries the load: the action **already executed**, and the observation
 * below this note is the page *after* it. Only the assertion failed. A note that read
 * "your action failed" would invite the planner to redo a submit that already went
 * through — the exact double-submit the T1 B2 trace shows was never needed.
 */
function renderRecallBoundary(observationHistoryEvicted?: boolean, actionDetailsEvicted?: boolean): string {
  if (!observationHistoryEvicted && !actionDetailsEvicted) return '';
  // see docs/02-architecture.md "The policy" — eviction is allowed to lose recall,
  // but never to turn absence into a guessed fact.
  const unavailable = [
    ...(observationHistoryEvicted ? ['prior page/observation content'] : []),
    ...(actionDetailsEvicted ? ['some older action details'] : []),
  ].join(' and ');
  return `
Recall boundary: history from ${unavailable} has been evicted. Only the action history represented
above and the current observation are available. If the task requires a missing earlier
fact, do not guess; return done with success=false,
failureClassification="recall_unavailable", and state which fact is unavailable.
`;
}

function renderRepair(repair?: BrowserExpectFailure): string {
  if (!repair) return '';
  return `
Note on your last action — it was PERFORMED, and the observation below is the page
after it. Only your "expect" did not hold: ${repair.reason}.
This usually means your postcondition was wrong, not that the action failed. Read the
observation and continue from the real state; do not repeat the action unless the
observation shows it truly did not take effect. Omit "expect" if you are unsure.
`;
}
