import { z } from 'zod';
import type { ElementResolutionResult } from '@rote/action';
import type { CapturedPage } from '@rote/browser';
import { BrowserExpectSchema, type TokenUsage, type TokenUsageSource } from '@rote/core';
import type { AdaptiveRenderedObservation } from '@rote/perception';

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
export const BrowserActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('navigate'), url: z.string().min(1), expect: BrowserExpectSchema.optional() }),
  z.object({ kind: z.literal('fill'), selector: z.string().min(1), stableId: z.string().length(16).optional(), role: z.string().optional(), name: z.string().optional(), text: z.string().optional(), value: z.string(), expect: BrowserExpectSchema.optional() }),
  z.object({ kind: z.literal('select'), selector: z.string().min(1), stableId: z.string().length(16).optional(), role: z.string().optional(), name: z.string().optional(), text: z.string().optional(), value: z.string(), expect: BrowserExpectSchema.optional() }),
  z.object({ kind: z.literal('click'), selector: z.string().min(1), stableId: z.string().length(16).optional(), role: z.string().optional(), name: z.string().optional(), text: z.string().optional(), expect: BrowserExpectSchema.optional() }),
  z.object({ kind: z.literal('done'), success: z.boolean(), summary: z.string().default('') }),
]);
export type BrowserAction = z.infer<typeof BrowserActionSchema>;

export interface BrowserPageSession {
  navigate(url: string): Promise<void>;
  capture(): Promise<CapturedPage>;
  fill(selector: string, value: string): Promise<void>;
  select(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
}

export interface PlannerContext {
  /** Cache-stable instructions, task, and action schema. */
  stablePrefix: string;
  /** Per-step page state, action history, and compact observation. */
  volatileSuffix: string;
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
  /** Bounded corrective calls made after malformed planner output. */
  repairUsage?: readonly TokenUsage[];
}

/** The usage sources the agent loop may request: a normal step, or a scoped repair. */
export type BrowserPlannerSource = Extract<TokenUsageSource, 'planner' | 'repair'>;

export interface BrowserPlannerClient {
  plan(source: BrowserPlannerSource, request: BrowserPlannerRequest): Promise<BrowserPlannerResponse>;
}

export interface BrowserAgentVerification {
  success: boolean;
  summary: string;
}

export interface BrowserAgentVerifier {
  verify(page: CapturedPage, task: string, plannerSummary: string): Promise<BrowserAgentVerification>;
}

export interface BrowserAgentRunRecorder {
  recordStep(step: BrowserAgentStep): Promise<void>;
  finish(outcome: 'success' | 'failure', summary: string, tokenUsage: readonly TokenUsage[]): Promise<void>;
}

export interface RunBrowserAgentOptions {
  task: string;
  page: BrowserPageSession;
  planner: BrowserPlannerClient;
  verifier: BrowserAgentVerifier;
  recorder?: BrowserAgentRunRecorder;
  maxSteps?: number;
  observationMaxChars?: number;
  clock?: () => number;
  /**
   * Scoped repairs allowed per run before a failed postcondition is fatal
   * (default 1). The budget is what keeps a non-fatal expect honest: without a
   * ceiling, "continue and let verify decide" would let a planner ignore every
   * assertion it authored. Exhausting it throws.
   */
  maxRepairs?: number;
}

export interface BrowserAgentStep {
  step: number;
  action: BrowserAction;
  observation: AdaptiveRenderedObservation;
  usage: TokenUsage;
  /** Planner-output repair usage associated with this action. */
  repairUsage?: readonly TokenUsage[];
  durationMs: number;
  error?: string;
  resolution?: ElementResolutionResult;
}

export interface BrowserAgentResult {
  success: boolean;
  summary: string;
  steps: readonly BrowserAgentStep[];
  tokenUsage: readonly TokenUsage[];
}
