import { z } from 'zod';
import type { CapturedPage } from '@rote/browser';
import type { TokenUsageSource } from '@rote/core';
import type { DistilledNode, RenderedObservation } from '@rote/perception';

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

export interface BrowserPlannerRequest {
  task: string;
  step: number;
  page: CapturedPage;
  nodes: readonly DistilledNode[];
  observation: RenderedObservation;
  previousActions: readonly BrowserAction[];
}

export interface BrowserPlannerResponse {
  action: BrowserAction;
}

export interface BrowserPlannerClient {
  plan(source: Extract<TokenUsageSource, 'planner'>, request: BrowserPlannerRequest): Promise<BrowserPlannerResponse>;
}

export interface RunBrowserAgentOptions {
  task: string;
  page: BrowserPageSession;
  planner: BrowserPlannerClient;
  maxSteps?: number;
  observationMaxChars?: number;
}

export interface BrowserAgentStep {
  step: number;
  action: BrowserAction;
  observation: RenderedObservation;
}

export interface BrowserAgentResult {
  success: boolean;
  summary: string;
  steps: readonly BrowserAgentStep[];
}
