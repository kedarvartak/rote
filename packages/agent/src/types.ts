import { z } from 'zod';
import { normalizeKeyChord } from '@rote/action';
import type { AllowedUploadFile, BrowserActionSafety, ElementResolutionResult, NormalizedKeyChord, PostActionEvidence } from '@rote/action';
import type { BrowserContextCoordinate, CapturedPage } from '@rote/browser';
import { BrowserExpectSchema, type ActionContract, type BrowserExpect, type TokenUsage, type TokenUsageSource } from '@rote/core';
import type { ActionKey, NextActionPrediction } from '@rote/predictor';
import type { ProviderUsageReceipt } from '@rote/llm';
import { StableNodeRefSchema, type AdaptiveRenderedObservation, type DistilledNode } from '@rote/perception';
import type { HistoryCompactionPolicy, HistoryCompactionRecord, PlannerActionHistory } from './history-compaction.js';

/**
 * `expect` is **optional** by deliberate design (#49).
 *
 * A model-authored postcondition can only assert what the model has already
 * observed, so a postcondition about a *future* page state is either a guess or a
 * tautology. On the T1 B2 fixture the confirmation section is `hidden` until the
 * submit lands and our distiller drops hidden nodes, so the post-click state was
 * not expressible in any primitive of the DSL — text or selector alike. Forcing a
 * field the model cannot fill produces invented strings, and a wrong guess failed
 * 7/7 correct runs. Omission is a truthful answer to "what do you expect?"; a
 * guess is not.
 *
 * This does not weaken verification: the independent final `verify` gate is
 * authored against ground truth and still decides success (docs/02 "Repair
 * ladder").
 */
export const BrowserStableIdSchema = StableNodeRefSchema;
const BrowserContextHashSchema = z.string().regex(/^[0-9a-f]{16}$/);
const OptionalBrowserStableIdSchema = z.preprocess(
  (value) => value === undefined || BrowserStableIdSchema.safeParse(value).success ? value : undefined,
  BrowserStableIdSchema.optional(),
);

/** Auditable reason a browser-agent run ended without success. */
export const BrowserAgentFailureClassificationSchema = z.enum([
  'recall_unavailable',
  'verification_failed',
  'step_budget_exhausted',
]);
/** Auditable browser-agent failure reason. */
export type BrowserAgentFailureClassification = z.infer<typeof BrowserAgentFailureClassificationSchema>;
const BrowserPlannerFailureClassificationSchema = z.literal('recall_unavailable');

export const BrowserActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('navigate'), url: z.string().min(1), expect: BrowserExpectSchema.optional() }),
  z.object({ kind: z.literal('fill'), selector: z.string().min(1), stableId: OptionalBrowserStableIdSchema, contextHash: BrowserContextHashSchema.optional(), role: z.string().optional(), name: z.string().optional(), text: z.string().optional(), value: z.string(), expect: BrowserExpectSchema.optional() }),
  z.object({ kind: z.literal('select'), selector: z.string().min(1), stableId: OptionalBrowserStableIdSchema, contextHash: BrowserContextHashSchema.optional(), role: z.string().optional(), name: z.string().optional(), text: z.string().optional(), value: z.string(), expect: BrowserExpectSchema.optional() }),
  z.object({ kind: z.literal('click'), selector: z.string().min(1), stableId: OptionalBrowserStableIdSchema, contextHash: BrowserContextHashSchema.optional(), role: z.string().optional(), name: z.string().optional(), text: z.string().optional(), expect: BrowserExpectSchema.optional() }),
  // E7.5 verbs (#131). `press.chord` is validated against the explicit chord
  // allowlist at parse time so an unnormalizable chord is malformed planner
  // output (one corrective call, #51), never something a dispatch path sees.
  // `upload` references an injected allowlisted file by id only — names,
  // paths, and content never appear in a planner-visible action.
  z.object({ kind: z.literal('hover'), selector: z.string().min(1), stableId: OptionalBrowserStableIdSchema, contextHash: BrowserContextHashSchema.optional(), role: z.string().optional(), name: z.string().optional(), text: z.string().optional(), expect: BrowserExpectSchema.optional() }),
  z.object({ kind: z.literal('press'), selector: z.string().min(1), stableId: OptionalBrowserStableIdSchema, contextHash: BrowserContextHashSchema.optional(), role: z.string().optional(), name: z.string().optional(), text: z.string().optional(), chord: z.string().min(1).superRefine((chord, context) => {
    try {
      normalizeKeyChord(chord);
    } catch (error) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : String(error) });
    }
  }), expect: BrowserExpectSchema.optional() }),
  z.object({ kind: z.literal('upload'), selector: z.string().min(1), stableId: OptionalBrowserStableIdSchema, contextHash: BrowserContextHashSchema.optional(), role: z.string().optional(), name: z.string().optional(), text: z.string().optional(), fileId: z.string().min(1), expect: BrowserExpectSchema.optional() }),
  z.object({ kind: z.literal('dragAndDrop'), selector: z.string().min(1), stableId: OptionalBrowserStableIdSchema, contextHash: BrowserContextHashSchema.optional(), role: z.string().optional(), name: z.string().optional(), text: z.string().optional(), targetSelector: z.string().min(1), targetStableId: OptionalBrowserStableIdSchema, targetRole: z.string().optional(), targetName: z.string().optional(), targetText: z.string().optional(), expect: BrowserExpectSchema.optional() }),
  z.object({
    kind: z.literal('done'),
    success: z.boolean(),
    summary: z.string().default(''),
    failureClassification: BrowserPlannerFailureClassificationSchema.optional(),
  }),
]).superRefine((action, context) => {
  if (action.kind === 'done' && action.success && action.failureClassification) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['failureClassification'],
      message: 'a successful done action cannot carry a failure classification',
    });
  }
});
export type BrowserAction = z.infer<typeof BrowserActionSchema>;

export const BrowserActionClassificationSchema = z.enum([
  'dropped_malformed_stable_id',
  'repaired_conflicting_target_identity',
]);
export type BrowserActionClassification = z.infer<typeof BrowserActionClassificationSchema>;

/** Normalizes optional planner hints while preserving auditable degradation classifications. */
export function normalizeBrowserAction(input: unknown): {
  action: BrowserAction;
  classifications: BrowserActionClassification[];
} {
  const classifications: BrowserActionClassification[] = [];
  if (hasMalformedStableId(input)) classifications.push('dropped_malformed_stable_id');
  return { action: BrowserActionSchema.parse(input), classifications };
}

function hasMalformedStableId(input: unknown): boolean {
  if (typeof input !== 'object' || input === null || !('kind' in input) || !('stableId' in input)) return false;
  const action = input as { kind?: unknown; stableId?: unknown };
  if (!['fill', 'select', 'click', 'hover', 'press', 'upload', 'dragAndDrop'].includes(String(action.kind)) || action.stableId === undefined) return false;
  return !BrowserStableIdSchema.safeParse(action.stableId).success;
}

export interface BrowserPageSession {
  navigate(url: string): Promise<void>;
  capture(): Promise<CapturedPage>;
  fill(selector: string, value: string, context?: BrowserContextCoordinate): Promise<void>;
  select(selector: string, value: string, context?: BrowserContextCoordinate): Promise<void>;
  click(selector: string, context?: BrowserContextCoordinate): Promise<void>;
  /**
   * E7.5 verbs are optional by design: a backend that lacks one produces a
   * typed `BrowserCapabilityUnsupportedError` before any side effect, so the
   * clean fallback path stays reachable (invariant 2). There is deliberately
   * no generic "dispatch arbitrary event" method.
   */
  hover?(selector: string, context?: BrowserContextCoordinate): Promise<void>;
  press?(selector: string, chord: NormalizedKeyChord, context?: BrowserContextCoordinate): Promise<void>;
  upload?(selector: string, file: { name: string; mimeType: string; contentBase64: string }, context?: BrowserContextCoordinate): Promise<void>;
  dragAndDrop?(sourceSelector: string, targetSelector: string, context?: BrowserContextCoordinate): Promise<void>;
  /**
   * The settle measured by the most recent action, when the session gates
   * actions on settledness (`SettledBrowserPageSession` does). The agent
   * records it per step so tier-2 site memory can derive settle priors from
   * measured settles rather than wall-clock guesses. Optional: a session
   * without a settledness gate simply records no settle.
   */
  lastSettle?(): { verb: string; elapsedMs: number } | undefined;
}

export interface PlannerContext {
  /** Cache-stable instructions, task, and action schema. */
  stablePrefix: string;
  /** Per-step page state, action history, and compact observation. */
  volatileSuffix: string;
  /** Bounded action history represented by the volatile suffix. */
  history: PlannerActionHistory;
}

/**
 * Why the previous step's postcondition failed, handed to the next planner call.
 *
 * Note this describes a *failed assertion*, not a failed action: on B2 the click
 * landed and the form was submitted — only the model's claim about the result was
 * wrong. So the repair must let the planner reconcile against the post-action
 * page, never blindly re-run the step it just performed.
 */
export interface BrowserExpectFailure {
  action: BrowserAction;
  reason: string;
}

export interface BrowserPlannerRequest {
  task: string;
  step: number;
  page: { url: string; title: string };
  observation: AdaptiveRenderedObservation;
  previousActions: readonly BrowserAction[];
  context: PlannerContext;
  /** Present only on a scoped repair call (docs/02 "Repair ladder" rung 2). */
  repair?: BrowserExpectFailure;
}

export interface BrowserPlannerResponse {
  action: BrowserAction;
  /** Usage for the requested planning call, including a malformed first completion. */
  usage: TokenUsage;
  /** Raw receipt for the requested planning call, when supplied by a real provider client. */
  providerReceipt?: ProviderUsageReceipt;
  /** Bounded corrective calls made after malformed planner output. */
  repairUsage?: readonly TokenUsage[];
  /** Raw receipts aligned one-to-one with `repairUsage`. */
  repairProviderReceipts?: readonly ProviderUsageReceipt[];
  /** Non-fatal optional-hint degradation applied before action resolution. */
  classifications?: readonly BrowserActionClassification[];
}

/** The usage sources the agent loop may request: a normal step, or a scoped repair. */
export type BrowserPlannerSource = Extract<TokenUsageSource, 'planner' | 'repair'>;

export interface BrowserPlannerClient {
  plan(source: BrowserPlannerSource, request: BrowserPlannerRequest): Promise<BrowserPlannerResponse>;
}

export interface BrowserAgentVerification {
  success: boolean;
  summary: string;
  /**
   * The declarative checks this verifier evaluated and that held (text/URL/selector
   * primitives of the Expect DSL). Recorded on the run so the distiller can learn a
   * playbook's `verify` from a real success instead of a caller declaring it. A
   * verifier that decides by model judgment or opaque logic omits them — such a run
   * cannot teach a `verify` and the distiller refuses rather than guessing.
   */
  checks?: readonly BrowserExpect[];
}

export interface BrowserAgentVerifier {
  verify(page: CapturedPage, task: string, plannerSummary: string): Promise<BrowserAgentVerification>;
}

/** Pre-dispatch policy failure that may be repaired without side effects. */
export class BrowserActionGuardError extends Error {
  constructor(
    message: string,
    readonly candidateRole?: string,
    readonly candidateName?: string,
  ) {
    super(message);
    this.name = 'BrowserActionGuardError';
  }
}

/** Current grounded action identity supplied to an injected pre-dispatch policy. */
export interface BrowserActionGuardInput {
  action: BrowserAction;
  nodes: readonly DistilledNode[];
  resolvedSelector?: string;
}

export interface BrowserAgentRunRecorder {
  recordStep(step: BrowserAgentStep): Promise<void>;
  finish(outcome: 'success' | 'failure', summary: string, tokenUsage: readonly TokenUsage[]): Promise<void>;
}

/**
 * Tier-2 site memory rendered as tier-0 content (docs/02 "Tiers 1 and 2"): a
 * run-stable, value-free, pre-budgeted brief. Advisory — the planner still
 * observes and every action is still verified — and constant within a run so
 * it lives in the cache-stable prefix.
 */
export interface SiteBriefInput {
  /** Rendered brief text (already cut to its character budget); empty renders nothing. */
  text: string;
  /** Stable identity refs the brief mentions; the run reports how many the planner actually used. */
  hintedStableIds: readonly string[];
}

/** docs/03-benchmark.md "hint utility": how much of the brief the planner actually acted on. */
export interface SiteBriefUtility {
  chars: number;
  hinted: number;
  /** Hinted identities that were dispatched at least once. */
  used: number;
}

/**
 * Shadow next-action predictor (P2 item 10 systems work): consulted before every
 * planner call with the value-free history, compared with what the planner then
 * chose, and recorded — never dispatched. This is how the real-page hit rate and
 * calibration are measured on live runs before speculation (P3) may act on it.
 */
export interface BrowserActionPredictor {
  predict(history: readonly ActionKey[]): NextActionPrediction;
}

export interface BrowserModelRouting {
  /** The small/cheap planner for grounded routine steps; must be a fully tagged planner like any other. */
  routine: BrowserPlannerClient;
  /** Route to `routine` only when the shadow prediction's confidence is at least this (default 0.9). */
  minConfidence?: number;
}

/**
 * Escalation contract: a routine step that fails *before dispatch* — malformed
 * planner output or an unresolvable/guarded target — is re-planned by the frontier
 * model, so a cheap model can only cost a call, never a wrong action.
 */
export interface BrowserStepRoute {
  planner: 'routine' | 'frontier';
  reason: 'prediction_confident' | 'no_confident_prediction' | 'repair' | 'no_routing';
  escalated?: 'planner_output' | 'target_repair';
}

/** Recorded per step: what the shadow predictor said and whether the planner agreed. */
export interface BrowserStepPrediction {
  predicted?: ActionKey;
  confidence: number;
  source: NextActionPrediction['source'];
  hit: boolean;
}

export interface RunBrowserAgentOptions {
  task: string;
  page: BrowserPageSession;
  planner: BrowserPlannerClient;
  verifier: BrowserAgentVerifier;
  /** Advisory site brief for the stable prefix; omit for a cold site (T3: Rote gets out of the way). */
  siteBrief?: SiteBriefInput;
  /** Shadow predictor; predictions are recorded against the planner's choice and never dispatched. */
  predictor?: BrowserActionPredictor;
  /**
   * Model routing (P2 item 12): a cheaper `routine` planner takes a step when the
   * shadow predictor is confident the step is a warm, known move; the frontier
   * `planner` takes every other step, every repair, and every escalation. The
   * routing decision itself is deterministic (no `route` model call in v1).
   */
  routing?: BrowserModelRouting;
  /** Optional deterministic pre-dispatch policy; thrown guard errors get one repair. */
  beforeAction?: (input: BrowserActionGuardInput) => void;
  recorder?: BrowserAgentRunRecorder;
  maxSteps?: number;
  observationMaxChars?: number;
  /** Hard ceiling for an explicit grounded snapshot that establishes a diff base. */
  observationBootstrapMaxChars?: number;
  /** B4 policy; `false` retains the unbounded baseline for measurement. */
  historyCompactionPolicy?: HistoryCompactionPolicy | false;
  clock?: () => number;
  /**
   * Scoped repairs allowed per run before a failed postcondition is fatal
   * (default 1). The budget is what keeps a non-fatal expect honest: without a
   * ceiling, "continue and let verify decide" would let a planner ignore every
   * assertion it authored. Exhausting it throws.
   */
  maxRepairs?: number;
  /** One pre-action correction for an ungrounded target; set 0 to fail immediately. */
  maxTargetRepairs?: 0 | 1;
  /**
   * Uploads the embedder permits, referenced by planner actions via `fileId`
   * only. Absent or empty means every upload action fails closed before
   * dispatch — there is no implicit filesystem access (#131).
   */
  uploadFiles?: readonly AllowedUploadFile[];
}

/** Verification outcome recorded on the terminal `done` step (value-free apart from the checks themselves). */
export interface BrowserAgentStepVerification {
  success: boolean;
  summary: string;
  /** Declarative checks that held; the distiller learns `verify` from these. */
  checks?: readonly BrowserExpect[];
  /** Authoritative evidence classes the gate consumed (E7.4); a learned playbook must be replayed under the same policy. */
  evidenceClasses?: readonly string[];
}

export interface BrowserAgentStep {
  step: number;
  action: BrowserAction;
  observation: AdaptiveRenderedObservation;
  usage: TokenUsage;
  /** Raw receipt for the requested planning call. */
  providerReceipt?: ProviderUsageReceipt;
  /** Planner-output repair usage associated with this action. */
  repairUsage?: readonly TokenUsage[];
  /** Raw receipts aligned one-to-one with `repairUsage`. */
  repairProviderReceipts?: readonly ProviderUsageReceipt[];
  /** Non-fatal optional-hint degradation applied before action resolution. */
  classifications?: readonly BrowserActionClassification[];
  /** Redacted zero-LLM effect/reaction evidence from the settled post-action capture. */
  postActionEvidence?: PostActionEvidence;
  /** Redacted B4 boundary telemetry; representative values remain only in planner context. */
  historyCompaction?: HistoryCompactionRecord;
  durationMs: number;
  error?: string;
  resolution?: ElementResolutionResult;
  /** Drop-target resolution for `dragAndDrop`; the source uses `resolution`. */
  targetResolution?: ElementResolutionResult;
  /** E7.5 safety classification recorded for every non-`done` dispatched action. */
  actionSafety?: BrowserActionSafety;
  /** Independent verification result; present only on a planner-declared successful `done`. */
  verification?: BrowserAgentStepVerification;
  /** Shadow prediction made before this step's planner call, scored against the planner's action. */
  prediction?: BrowserStepPrediction;
  /** Which planner took this step and why; present whenever routing is configured. */
  route?: BrowserStepRoute;
  /** Usage spent by a routine planner whose output failed closed before the frontier re-planned the step. */
  escalationUsage?: readonly TokenUsage[];
  /** 16-hex digest of origin+pathname of the page the step acted on (site memory keys on it; never a raw URL). */
  pageKey?: string;
  /** Same digest for the settled page after dispatch; differs from `pageKey` on a page edge. */
  nextPageKey?: string;
  /** Milliseconds the post-action settledness gate waited after this step's dispatch. */
  settleMs?: number;
  /**
   * Value-free action contract derived from the resolved live target before dispatch
   * (#143): what the distiller may later persist so replay can detect a same-looking
   * control whose behavior changed. Absent for `navigate`/`done` and for targets
   * whose capture carries no affordance.
   */
  actionContract?: ActionContract;
  /**
   * How this step's page relates to the previous step's (#132). A same-document
   * route change keeps the observation diff base; only a document change resets
   * it. Absent on the first step and when neither URL nor document changed.
   */
  pageTransition?: BrowserPageTransition;
}

/** Page epoch relation between consecutive steps; see `BrowserAgentStep.pageTransition`. */
export interface BrowserPageTransition {
  /** URL differs from the previous step (real navigation or SPA route push). */
  routeChanged: boolean;
  /**
   * Top-level document was replaced. Derived from `CapturedPage.documentToken`
   * when both captures carry one; otherwise a URL change is treated as a
   * document change (legacy backends cannot tell the two apart).
   */
  documentChanged: boolean;
}

export interface BrowserAgentResult {
  success: boolean;
  summary: string;
  /** Harness- or planner-declared reason for a clean non-success result. */
  failureClassification?: BrowserAgentFailureClassification;
  steps: readonly BrowserAgentStep[];
  tokenUsage: readonly TokenUsage[];
  /** Present when a site brief was supplied: its size and how much of it the planner used. */
  siteBriefUtility?: SiteBriefUtility;
  /** Present when a shadow predictor was supplied: steps predicted and how many the planner agreed with. */
  predictionSummary?: { predicted: number; hits: number };
  /** Present when routing was configured: steps taken by each planner and escalations (the "≥50% of warm steps off the frontier" gate reads this). */
  routingSummary?: { routine: number; frontier: number; escalations: number };
}
