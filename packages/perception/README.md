# @rote/perception

Pure perception logic for Rote's V1 browser-agent harness: captured pages become
stable, compact observations the agent can consume cheaply. The package has no
browser I/O; capture lives in `@rote/browser`.

This is the first piece of the V1 efficiency claim: avoid handing the model a raw page
dump when a compact tree of actionable elements is enough.

## Affordance (#143)

Every interactive `DistilledNode` carries `affordance`: control kind, input type, Enter
behavior, 16-hex destination digest (link href / form action origin+path), form method,
`enabled`, `draggable` — derived only from capture-time attributes and the
`data-rote-form-action|method|implicit-submit` facts stamped by `@rote/browser`, so static
and CDP captures agree. It is value-free and never rendered into the observation; it feeds
`deriveActionContract` in `@rote/action`.

## Public API

- `distillPage(page)` — keep visible interactive/content-bearing nodes across captured composed contexts, derive associated-label and ARIA names, retain context-local selectors, and assign roles, identity-v2 IDs, and diffable state. V2 hashes durable browsing context and allowlisted container lineage while excluding runtime IDs, document tokens, selectors, and control values.
- `renderObservation(nodes, { maxChars })` — render a compact, budgeted full observation.
- `diffObservations(base, current)` / `applyObservationDiff(base, diff)` — ordered stable-ID diffs with exact reconstruction and malformed-diff rejection.
- `renderAdaptiveObservation(nodes, options)` — use ordinary-budget full/diff observations; when no diff base exists, emit one explicitly metered grounded snapshot under a separate hard bootstrap ceiling, then return to diffs. Throws `ObservationBootstrapLimitError` before planning above that ceiling.
- `StableNodeIdV1Schema` / `StableNodeIdV2Schema` / `StableNodeIdSchema` — preserve historical IDs unchanged while parsing and emitting explicit context-aware v2 identities.
- `StableNodeRefSchema` / `stableNodeRef(id)` — preserve the identity version in planner/action/trajectory references (`v2:<hash>`), while accepting historical unprefixed v1 references.
- `isElementVisible(element)` / `matchesElementSelector(element, selector)` — the two
  captured-element predicates every layer shares. Observation, dispatch and verification
  must agree on what is visible and on what a selector names; they previously held three
  and two implementations that had drifted, so the rule lives here once and
  `packages/executor/test/invariants/element-predicates-agree.test.ts` holds them to it.
- `estimateTokens(text)` — approximate token count for budget tests.

## Running tests

```bash
npm test --workspace @rote/perception
```

Run the live local CDP distillation coverage when Chrome/Chromium is available:

```bash
ROTE_RUN_CDP_TESTS=1 npm test --workspace @rote/perception
```
