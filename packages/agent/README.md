# @rote/agent

Compact-observation browser-agent control loop for Rote's V1 harness. It connects a
stateful browser page from `@rote/browser` to adaptive full/diff/summary perception from
`@rote/perception`, then asks a source-tagged planner for the next browser action.

This package is deliberately planner-client agnostic: production LLM providers plug in
behind `BrowserPlannerClient`, while tests use deterministic scripted planners.

## Public API

- `runBrowserAgent(options)` — observe → plan → act loop until `done` or the step budget is exhausted; planner-declared success is gated by an injected verifier.
- `BrowserPlannerClient` — planner interface; calls are always tagged with `source: 'planner'`.
- `TaggedLlmBrowserPlanner` — production planner adapter over `@rote/llm`; strictly parses one typed action, gives malformed output one scoped corrective call, and returns both the original and `repair`-tagged provider usage. Exhausting the bounded repair fails closed.
- `assemblePlannerContext(options)` — separates cache-stable instructions/task/action schemas from volatile page observations and action history.
- `normalizeBrowserAction(input)` — parses one action while returning auditable classifications for non-fatal optional-hint degradation.
- `BrowserPageSession` — minimal page-action surface required by the loop.
- `BrowserAction` — Zod-backed action union: `navigate`, `fill`, `select`, `click`, `done`. A mutating action **may** carry a closed browser `expect` postcondition; it is optional because a model can only assert what it has already observed, so a mandatory field yields guesses or tautologies (#49/#50). Element actions may carry semantic identity for resilient resolution; malformed optional stable IDs are dropped into the semantic fallback chain and recorded as `dropped_malformed_stable_id` rather than failing the run (#52).
- `BrowserPlannerClient.plan(source, request)` — `source` is `'planner'` or `'repair'`; a repair call carries `request.repair` (the failed action and why its postcondition did not hold) and is billed under its own usage tag.
- `runBrowserAgent({ maxRepairs })` — scoped repairs allowed before a failed postcondition is fatal (default 1). A failed expect means the model's belief was wrong, not necessarily the action, so the repair reconciles against the post-action page rather than replaying the step. Success still requires the independent verifier.
- `FileBrowserAgentRunRecorder` — writes browser decisions/actions to append-only trajectory JSONL and a benchmark-compatible run manifest with planner usage.

## Running tests

```bash
npm test --workspace @rote/agent
```

Run the live local CDP fixture smoke against the stateful B1–B3 confirmation flows when Chrome/Chromium is available:

```bash
ROTE_RUN_CDP_TESTS=1 npm test --workspace @rote/agent
```
