# @rote/perception

Pure perception logic for Rote's P1 browser-agent harness: captured pages become
stable, compact observations the agent can consume cheaply. The package has no
browser I/O; capture lives in `@rote/browser` and the future CDP backend.

## Public API

- `distillPage(page)` — keep interactive/content-bearing nodes, assign roles,
  names, selector hints, and stable IDs.
- `renderObservation(nodes, { maxChars })` — render a compact, budgeted text
  observation.
- `estimateTokens(text)` — approximate token count for budget tests.

## Running tests

```bash
npm test --workspace @rote/perception
```
