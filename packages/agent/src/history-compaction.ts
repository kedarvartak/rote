import { sha256Hex } from '@rote/core';
import { z } from 'zod';
import { BrowserActionSchema, type BrowserAction } from './types.js';

const ActionKindCountsSchema = z.object({
  navigate: z.number().int().nonnegative(),
  fill: z.number().int().nonnegative(),
  select: z.number().int().nonnegative(),
  click: z.number().int().nonnegative(),
  hover: z.number().int().nonnegative(),
  press: z.number().int().nonnegative(),
  upload: z.number().int().nonnegative(),
  dragAndDrop: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
});

/** Cache-amortized limits for deterministic action-history compaction. */
export const HistoryCompactionPolicySchema = z.object({
  maxActionsBeforeCompaction: z.number().int().positive(),
  compactionInterval: z.number().int().positive(),
  recentActionCount: z.number().int().positive(),
  representativeActionLimit: z.number().int().nonnegative(),
}).superRefine((policy, context) => {
  if (policy.recentActionCount >= policy.maxActionsBeforeCompaction) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['recentActionCount'],
      message: 'recentActionCount must be below maxActionsBeforeCompaction',
    });
  }
  if (policy.compactionInterval > policy.maxActionsBeforeCompaction) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['compactionInterval'],
      message: 'compactionInterval must not exceed maxActionsBeforeCompaction',
    });
  }
});
/** Cache-amortized limits for deterministic action-history compaction. */
export type HistoryCompactionPolicy = z.infer<typeof HistoryCompactionPolicySchema>;

/**
 * Default B4 schedule.
 *
 * T10 measured roughly 35–40 logical tokens per action. Sixteen appended actions
 * therefore amortize a cache miss over several OpenAI 128-token cache increments,
 * while an exact tail of eight keeps immediate procedure state available.
 */
export const DEFAULT_HISTORY_COMPACTION_POLICY: HistoryCompactionPolicy = Object.freeze(
  HistoryCompactionPolicySchema.parse({
    maxActionsBeforeCompaction: 24,
    compactionInterval: 16,
    recentActionCount: 8,
    representativeActionLimit: 8,
  }),
);

/** Redacted telemetry proving where deterministic history compaction occurred. */
export const HistoryCompactionRecordSchema = z.object({
  version: z.literal(1),
  compactedActionCount: z.number().int().positive(),
  throughActionIndex: z.number().int().nonnegative(),
  retainedRepresentativeCount: z.number().int().nonnegative(),
  historyDigest: z.string().regex(/^[0-9a-f]{64}$/),
  detailsEvicted: z.literal(true),
  kindCounts: ActionKindCountsSchema,
});
/** Redacted telemetry proving where deterministic history compaction occurred. */
export type HistoryCompactionRecord = z.infer<typeof HistoryCompactionRecordSchema>;

/** Bounded action history visible to one planner request. */
export const PlannerActionHistorySchema = z.object({
  text: z.string(),
  visibleActions: z.array(BrowserActionSchema),
  compaction: HistoryCompactionRecordSchema.optional(),
});
/** Bounded action history visible to one planner request. */
export type PlannerActionHistory = z.infer<typeof PlannerActionHistorySchema>;

/**
 * Builds a bounded, provenance-preserving planner history.
 *
 * `false` retains the unbounded baseline for measurement. Compacted representatives
 * are references to actual prior actions; missing detail is marked unavailable rather
 * than synthesized into a plausible procedure.
 */
export function buildPlannerActionHistory(
  actions: readonly BrowserAction[],
  policy: HistoryCompactionPolicy | false = DEFAULT_HISTORY_COMPACTION_POLICY,
): PlannerActionHistory {
  if (policy === false) return uncompactedHistory(actions);
  const parsedPolicy = HistoryCompactionPolicySchema.parse(policy);
  if (actions.length <= parsedPolicy.maxActionsBeforeCompaction) return uncompactedHistory(actions);

  const compactableCount = actions.length - parsedPolicy.recentActionCount;
  const compactedActionCount = Math.floor(compactableCount / parsedPolicy.compactionInterval)
    * parsedPolicy.compactionInterval;
  if (compactedActionCount <= 0) return uncompactedHistory(actions);

  const compacted = actions.slice(0, compactedActionCount);
  const recent = actions.slice(compactedActionCount);
  const representatives = selectRepresentatives(compacted, parsedPolicy.representativeActionLimit);
  const record = HistoryCompactionRecordSchema.parse({
    version: 1,
    compactedActionCount,
    throughActionIndex: compactedActionCount - 1,
    retainedRepresentativeCount: representatives.length,
    historyDigest: sha256Hex(JSON.stringify(compacted)),
    detailsEvicted: true,
    kindCounts: countActionKinds(compacted),
  });
  const representativeText = representatives.length === 0
    ? '(none retained)'
    : representatives.map((action) => JSON.stringify(action)).join('\n');
  const recentText = recent.length === 0
    ? '(none)'
    : recent.map((action) => JSON.stringify(action)).join('\n');

  return PlannerActionHistorySchema.parse({
    text: `Compacted action history v1 (older details unavailable):\n${JSON.stringify(record)}\nRepresentative older actions (actual prior actions):\n${representativeText}\nRecent actions (exact):\n${recentText}`,
    visibleActions: [...representatives, ...recent],
    compaction: record,
  });
}

function uncompactedHistory(actions: readonly BrowserAction[]): PlannerActionHistory {
  return PlannerActionHistorySchema.parse({
    text: actions.length === 0 ? '(none)' : actions.map((action) => JSON.stringify(action)).join('\n'),
    visibleActions: [...actions],
  });
}

function selectRepresentatives(actions: readonly BrowserAction[], limit: number): BrowserAction[] {
  if (limit === 0) return [];
  const selected: Array<{ index: number; action: BrowserAction }> = [];
  const seen = new Set<string>();
  for (let index = actions.length - 1; index >= 0 && selected.length < limit; index -= 1) {
    const action = actions[index]!;
    const key = representativeKey(action);
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push({ index, action });
  }
  return selected.sort((left, right) => left.index - right.index).map(({ action }) => action);
}

function representativeKey(action: BrowserAction): string {
  if (action.kind === 'navigate' || action.kind === 'done') return action.kind;
  const target = action.stableId
    ?? `${action.role ?? ''}\u0000${action.name ?? action.text ?? ''}\u0000${action.selector}`;
  return `${action.kind}\u0000${target}`;
}

function countActionKinds(actions: readonly BrowserAction[]): z.infer<typeof ActionKindCountsSchema> {
  const counts = { navigate: 0, fill: 0, select: 0, click: 0, hover: 0, press: 0, upload: 0, dragAndDrop: 0, done: 0 };
  for (const action of actions) counts[action.kind] += 1;
  return counts;
}
