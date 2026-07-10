import { distillPage, renderObservation } from '@rote/perception';
import { assemblePlannerContext } from './context.js';
import { BrowserActionSchema, type BrowserAction, type BrowserAgentResult, type BrowserAgentStep, type RunBrowserAgentOptions } from './types.js';

/** Runs the compact-observation browser-agent loop until the planner returns `done`. */
export async function runBrowserAgent(options: RunBrowserAgentOptions): Promise<BrowserAgentResult> {
  const maxSteps = options.maxSteps ?? 20;
  const clock = options.clock ?? Date.now;
  const previousActions: BrowserAction[] = [];
  const steps: BrowserAgentStep[] = [];
  let finished = false;

  try {
    for (let step = 0; step < maxSteps; step += 1) {
      const startedAt = clock();
      const page = await options.page.capture();
      const nodes = distillPage(page);
      const observation = renderObservation(nodes, { maxChars: options.observationMaxChars });
      const pageState = { url: page.url, title: page.title };
      const context = assemblePlannerContext({
        task: options.task,
        page: pageState,
        observation: observation.text,
        previousActions,
      });
      // INVARIANT: planner calls are always source-tagged for benchmark accounting.
      const planned = await options.planner.plan('planner', {
        task: options.task,
        step,
        page: pageState,
        observation,
        previousActions,
        context,
      });
      const action = BrowserActionSchema.parse(planned.action);
      // INVARIANT: usage returned by a planner cannot be relabeled as another source.
      if (planned.usage.source !== 'planner') throw new Error(`planner returned usage tagged ${planned.usage.source}`);

      let actionError: Error | undefined;
      if (action.kind !== 'done') {
        try {
          await applyAction(options.page, action);
          previousActions.push(action);
        } catch (error) {
          actionError = asError(error);
        }
      }
      const recordedStep: BrowserAgentStep = {
        step,
        action,
        observation,
        usage: planned.usage,
        durationMs: Math.max(0, clock() - startedAt),
        ...(actionError ? { error: actionError.message } : {}),
      };
      steps.push(recordedStep);
      await options.recorder?.recordStep(recordedStep);
      if (actionError) throw actionError;

      if (action.kind === 'done') {
        let success = action.success;
        let summary = action.summary;
        if (success) {
          const verification = await options.verifier.verify(await options.page.capture(), options.task, action.summary);
          success = verification.success;
          summary = verification.summary;
        }
        // INVARIANT: planner-declared completion is never success until an independent verifier passes.
        const result = resultFromSteps(success, summary, steps);
        finished = true;
        await options.recorder?.finish(success ? 'success' : 'failure', summary, result.tokenUsage);
        return result;
      }
    }

    const summary = `planner exceeded maxSteps=${maxSteps}`;
    const result = resultFromSteps(false, summary, steps);
    finished = true;
    await options.recorder?.finish('failure', summary, result.tokenUsage);
    return result;
  } catch (error) {
    const failure = asError(error);
    if (!finished) {
      finished = true;
      await options.recorder?.finish('failure', failure.message, steps.map((entry) => entry.usage));
    }
    throw failure;
  }
}

function resultFromSteps(success: boolean, summary: string, steps: BrowserAgentStep[]): BrowserAgentResult {
  return { success, summary, steps, tokenUsage: steps.map((entry) => entry.usage) };
}

async function applyAction(page: RunBrowserAgentOptions['page'], action: BrowserAction): Promise<void> {
  switch (action.kind) {
    case 'navigate':
      await page.navigate(action.url);
      return;
    case 'fill':
      await page.fill(action.selector, action.value);
      return;
    case 'select':
      await page.select(action.selector, action.value);
      return;
    case 'click':
      await page.click(action.selector);
      return;
    case 'done':
      return;
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
