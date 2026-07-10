import type { BrowserAction, PlannerContext } from './types.js';

const ACTION_SCHEMA = `Actions (return exactly one JSON object):
- {"kind":"navigate","url":"https://..."}
- {"kind":"fill","selector":"#id","value":"text"}
- {"kind":"select","selector":"#id","value":"option-value"}
- {"kind":"click","selector":"#id"}
- {"kind":"done","success":true|false,"summary":"result"}`;

export interface AssemblePlannerContextOptions {
  task: string;
  page: { url: string; title: string };
  observation: string;
  previousActions: readonly BrowserAction[];
}

/** Builds a cache-stable planner prefix and a per-step volatile suffix. */
export function assemblePlannerContext(options: AssemblePlannerContextOptions): PlannerContext {
  // see docs/16-harness-architecture.md "Decision plane details" — stable material
  // stays before per-step state so provider prompt caches survive observation changes.
  const stablePrefix = `You are Rote's browser planner.
Choose one safe next action that advances the task. Use only selectors present in the observation.
Return JSON only; do not wrap it in markdown.

Task:
${options.task}

${ACTION_SCHEMA}`;
  const actionHistory = options.previousActions.length === 0
    ? '(none)'
    : options.previousActions.map((action) => JSON.stringify(action)).join('\n');
  const volatileSuffix = `Current page:
${options.page.title} | ${options.page.url}

Previous actions:
${actionHistory}

Compact observation:
${options.observation}`;
  return { stablePrefix, volatileSuffix };
}
