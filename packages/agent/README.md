# @rote/agent

Compact-observation browser-agent control loop for Rote's V1 harness. It connects a
stateful browser page from `@rote/browser` to perception distillation from
`@rote/perception`, then asks a source-tagged planner for the next browser action.

This package is deliberately planner-client agnostic: production LLM providers plug in
behind `BrowserPlannerClient`, while tests use deterministic scripted planners.

## Public API

- `runBrowserAgent(options)` — observe → plan → act loop until `done` or the step budget is exhausted.
- `BrowserPlannerClient` — planner interface; calls are always tagged with `source: 'planner'`.
- `assemblePlannerContext(options)` — separates cache-stable instructions/task/action schemas from volatile page observations and action history.
- `BrowserPageSession` — minimal page-action surface required by the loop.
- `BrowserAction` — Zod-backed action union: `navigate`, `fill`, `select`, `click`, `done`.

## Running tests

```bash
npm test --workspace @rote/agent
```

Run the live local CDP fixture smoke when Chrome/Chromium is available:

```bash
ROTE_RUN_CDP_TESTS=1 npm test --workspace @rote/agent
```
