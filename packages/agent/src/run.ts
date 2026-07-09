import { distillPage, renderObservation } from '@rote/perception';
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
    // INVARIANT: planner calls are always source-tagged for benchmark accounting.
    const planned = await options.planner.plan('planner', {
      task: options.task,
      step,
      page,
      nodes,
      observation,
      previousActions,
    });
    const action = BrowserActionSchema.parse(planned.action);
    steps.push({ step, action, observation });

    if (action.kind === 'done') {
      return { success: action.success, summary: action.summary, steps };
    }

    await applyAction(options.page, action);
    previousActions.push(action);
  }

  return { success: false, summary: `planner exceeded maxSteps=${maxSteps}`, steps };
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
