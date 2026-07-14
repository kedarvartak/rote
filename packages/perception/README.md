# @rote/perception

Pure perception logic for Rote's V1 browser-agent harness: captured pages become
stable, compact observations the agent can consume cheaply. The package has no
browser I/O; capture lives in `@rote/browser`.

This is the first piece of the V1 efficiency claim: avoid handing the model a raw page
dump when a compact tree of actionable elements is enough.

## Public API

- `distillPage(page)` — keep interactive/content-bearing nodes, assign roles,
  names, selector hints, and stable IDs.
- `renderObservation(nodes, { maxChars })` — render a compact, budgeted full observation.
- `diffObservations(base, current)` / `applyObservationDiff(base, diff)` — ordered stable-ID diffs with exact reconstruction and malformed-diff rejection.
- `renderAdaptiveObservation(nodes, options)` — degrade full → diff → summary under a hard character budget.
- `estimateTokens(text)` — approximate token count for budget tests.

## Running tests

```bash
npm test --workspace @rote/perception
```

Run the live local CDP distillation coverage when Chrome/Chromium is available:

```bash
ROTE_RUN_CDP_TESTS=1 npm test --workspace @rote/perception
```
