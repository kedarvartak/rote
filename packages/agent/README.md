# @rote/agent

Compact-observation browser-agent control loop for Rote's V1 harness. It connects a
stateful browser page from `@rote/browser` to adaptive full/diff/summary perception from
`@rote/perception`, then asks a source-tagged planner for the next browser action.

This package is deliberately planner-client agnostic: production LLM providers plug in
behind `BrowserPlannerClient`, while tests use deterministic scripted planners.

## Public API

- `runBrowserAgent(options)` — observe → plan → act loop until `done` or the step budget is exhausted; planner-declared success is gated by an injected verifier.
- `BrowserPlannerClient` — planner interface; calls are always tagged with `source: 'planner'`.
- `TaggedLlmBrowserPlanner` — production planner adapter over `@rote/llm`; strictly parses one typed action and returns provider token usage.
- `assemblePlannerContext(options)` — separates cache-stable instructions/task/action schemas from volatile page observations and action history.
- `BrowserPageSession` — minimal page-action surface required by the loop.
- `BrowserAction` — Zod-backed action union: `navigate`, `fill`, `select`, `click`, `done`; every mutating action requires a closed browser `expect` postcondition, and element actions may carry semantic identity for resilient resolution.
- `FileBrowserAgentRunRecorder` — writes browser decisions/actions to append-only trajectory JSONL and a benchmark-compatible run manifest with planner usage.

## Running tests

```bash
npm test --workspace @rote/agent
```

Run the live local CDP fixture smoke against the stateful B1–B3 confirmation flows when Chrome/Chromium is available:

```bash
ROTE_RUN_CDP_TESTS=1 npm test --workspace @rote/agent
```
