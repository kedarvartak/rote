import { z } from 'zod';
import type { CapturedPage } from '@rote/browser';
import type { TokenUsage, TokenUsageSource } from '@rote/core';
import type { RenderedObservation } from '@rote/perception';

export const BrowserActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('navigate'), url: z.string().min(1) }),
  z.object({ kind: z.literal('fill'), selector: z.string().min(1), value: z.string() }),
  z.object({ kind: z.literal('select'), selector: z.string().min(1), value: z.string() }),
  z.object({ kind: z.literal('click'), selector: z.string().min(1) }),
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

export interface BrowserPlannerRequest {
  task: string;
  step: number;
  page: { url: string; title: string };
  observation: RenderedObservation;
  previousActions: readonly BrowserAction[];
  context: PlannerContext;
}

export interface BrowserPlannerResponse {
  action: BrowserAction;
  usage: TokenUsage;
}

export interface BrowserPlannerClient {
  plan(source: Extract<TokenUsageSource, 'planner'>, request: BrowserPlannerRequest): Promise<BrowserPlannerResponse>;
}

export interface BrowserAgentRunRecorder {
  recordStep(step: BrowserAgentStep): Promise<void>;
  finish(outcome: 'success' | 'failure', summary: string, tokenUsage: readonly TokenUsage[]): Promise<void>;
}

export interface RunBrowserAgentOptions {
  task: string;
  page: BrowserPageSession;
  planner: BrowserPlannerClient;
  recorder?: BrowserAgentRunRecorder;
  maxSteps?: number;
  observationMaxChars?: number;
  clock?: () => number;
}

export interface BrowserAgentStep {
  step: number;
  action: BrowserAction;
  observation: RenderedObservation;
  usage: TokenUsage;
  durationMs: number;
  error?: string;
}

export interface BrowserAgentResult {
  success: boolean;
  summary: string;
  steps: readonly BrowserAgentStep[];
  tokenUsage: readonly TokenUsage[];
}
