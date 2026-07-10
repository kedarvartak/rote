import { distillPage, renderObservation } from '@rote/perception';
import { assemblePlannerContext } from './context.js';
import { BrowserActionSchema, type BrowserAction, type BrowserAgentResult, type BrowserAgentStep, type RunBrowserAgentOptions } from './types.js';

/** Runs the compact-observation browser-agent loop until the planner returns `done`. */
export async function runBrowserAgent(options: RunBrowserAgentOptions): Promise<BrowserAgentResult> {
  const maxSteps = options.maxSteps ?? 20;
  const previousActions: BrowserAction[] = [];
  const steps: BrowserAgentStep[] = [];

  for (let step = 0; step < maxSteps; step += 1) {
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
    steps.push({ step, action, observation, usage: planned.usage });

    if (action.kind === 'done') {
      return { success: action.success, summary: action.summary, steps, tokenUsage: steps.map((entry) => entry.usage) };
    }

    await applyAction(options.page, action);
    previousActions.push(action);
  }

  return {
    success: false,
    summary: `planner exceeded maxSteps=${maxSteps}`,
    steps,
    tokenUsage: steps.map((entry) => entry.usage),
  };
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
