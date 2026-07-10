import type { TaggedLlmClient } from '@rote/llm';
import { BrowserActionSchema, type BrowserPlannerClient, type BrowserPlannerRequest, type BrowserPlannerResponse } from './types.js';

/** Raised when a planner completion is not one valid browser-action JSON object. */
export class BrowserPlannerOutputError extends Error {
  constructor(message: string, readonly output: string) {
    super(message);
    this.name = 'BrowserPlannerOutputError';
  }
}

/** Browser planner backed by Rote's shared source-tagged LLM client. */
export class TaggedLlmBrowserPlanner implements BrowserPlannerClient {
  constructor(private readonly client: TaggedLlmClient) {}

  async plan(source: 'planner', request: BrowserPlannerRequest): Promise<BrowserPlannerResponse> {
    const completion = await this.client.complete({
      source,
      stablePrefix: request.context.stablePrefix,
      volatileSuffix: request.context.volatileSuffix,
      maxTokens: 256,
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(completion.text);
    } catch {
      throw new BrowserPlannerOutputError('browser planner returned invalid JSON', completion.text);
    }
    const action = BrowserActionSchema.safeParse(parsed);
    if (!action.success) {
      throw new BrowserPlannerOutputError(`browser planner returned an invalid action: ${action.error.message}`, completion.text);
    }
    return { action: action.data, usage: completion.usage };
  }
}
