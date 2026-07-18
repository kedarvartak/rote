import type { TokenUsage } from '@rote/core';
import type { ProviderUsageReceipt, TaggedLlmClient } from '@rote/llm';
import { normalizeBrowserAction, type BrowserAction, type BrowserActionClassification, type BrowserPlannerClient, type BrowserPlannerRequest, type BrowserPlannerResponse, type BrowserPlannerSource } from './types.js';

/** Raised when bounded correction cannot produce one valid browser action. */
export class BrowserPlannerOutputError extends Error {
  constructor(
    message: string,
    readonly output: string,
    /** Every model call spent before the planner failed closed. */
    readonly usages: readonly TokenUsage[],
  ) {
    super(message);
    this.name = 'BrowserPlannerOutputError';
  }
}

/** Browser planner backed by Rote's shared source-tagged LLM client. */
export class TaggedLlmBrowserPlanner implements BrowserPlannerClient {
  constructor(
    private readonly client: TaggedLlmClient,
    private readonly maxOutputRepairs = 1,
  ) {}

  async plan(source: BrowserPlannerSource, request: BrowserPlannerRequest): Promise<BrowserPlannerResponse> {
    const usages: TokenUsage[] = [];
    let providerReceipt: ProviderUsageReceipt | undefined;
    const repairProviderReceipts: ProviderUsageReceipt[] = [];
    let volatileSuffix = request.context.volatileSuffix;
    let lastFailure: ParsedFailure | undefined;

    for (let attempt = 0; attempt <= this.maxOutputRepairs; attempt += 1) {
      // see docs/02-architecture.md "Repair ladder" — malformed output is a
      // recoverable planner-boundary slip, but every corrective call is scoped,
      // bounded, and separately tagged so success parity includes its cost.
      const attemptSource: BrowserPlannerSource = attempt === 0 ? source : 'repair';
      const completion = await this.client.complete({
        source: attemptSource,
        stablePrefix: request.context.stablePrefix,
        volatileSuffix,
        maxTokens: 256,
      });
      usages.push(completion.usage);
      if (attempt === 0) providerReceipt = completion.providerReceipt;
      else if (completion.providerReceipt) repairProviderReceipts.push(completion.providerReceipt);

      const parsed = parseAction(completion.text);
      if (parsed.success) {
        return {
          action: parsed.action,
          usage: usages[0]!,
          ...(providerReceipt ? { providerReceipt } : {}),
          ...(usages.length > 1 ? { repairUsage: usages.slice(1) } : {}),
          ...(repairProviderReceipts.length > 0 ? { repairProviderReceipts } : {}),
          ...(parsed.classifications.length > 0 ? { classifications: parsed.classifications } : {}),
        };
      }

      lastFailure = parsed;
      volatileSuffix = renderOutputRepair(request.context.volatileSuffix, parsed);
    }

    // INVARIANT: exhausting the repair budget fails closed; malformed output is
    // never guessed into an action or dropped from token accounting.
    throw new BrowserPlannerOutputError(lastFailure!.message, lastFailure!.output, usages);
  }
}

interface ParsedSuccess {
  success: true;
  action: BrowserAction;
  classifications: BrowserActionClassification[];
}

interface ParsedFailure {
  success: false;
  message: string;
  output: string;
}

function parseAction(output: string): ParsedSuccess | ParsedFailure {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return { success: false, message: 'browser planner returned invalid JSON', output };
  }
  try {
    const normalized = normalizeBrowserAction(parsed);
    return { success: true, ...normalized };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `browser planner returned an invalid action: ${message}`,
      output,
    };
  }
}

function renderOutputRepair(originalSuffix: string, failure: ParsedFailure): string {
  return `${originalSuffix}

Your previous response was not a valid browser action.
Validation error: ${failure.message}
Invalid response:
${failure.output}
Return exactly one corrected JSON action object and nothing else.`;
}
