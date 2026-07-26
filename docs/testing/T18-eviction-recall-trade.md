# T18 — Eviction recall-trade invariant

## Result

The tier-0 policy now has a deterministic two-page stress fixture in the sacred invariant
suite. Product A exposes a `$10` price; after navigation, Product B exposes `$9`. The
planner request retains the navigation action but intentionally contains no Product A
observation.

Two failure behaviors are enforced:

1. A planner that recognizes the missing fact returns `success=false` with
   `failureClassification="recall_unavailable"`. The run result and recorded `done` event
   retain that classification, the manifest is failure, and the verifier is never called.
2. A planner that fabricates “Product A is cheaper” cannot report success. Independent
   ground-truth verification returns failure with the harness-owned
   `verification_failed` classification.

This does not make compare-across-pages tasks work. It makes the known loss explicit and
prevents missing memory from becoming an accepted answer.

## Enforcement

Once a URL change or diff means prior observation content is omitted, subsequent volatile
planner context carries a recall boundary:

```text
prior page/observation content has been evicted ...
If the task requires a missing earlier fact, do not guess;
return ... failureClassification="recall_unavailable"
```

The warning is below the immutable provider-cache prefix, so within-run prefix bytes
remain stable. `BrowserAgentFailureClassificationSchema` is the Zod source for
`recall_unavailable`, `verification_failed`, and `step_budget_exhausted`; a successful
`done` action is rejected if it carries any failure classification. The CLI propagates a
clean failure classification instead of flattening it into an untyped summary.

## Reproduction

```bash
npm test --workspace @rote/agent -- --run \
  test/invariants/evicted-recall-fails-cleanly.test.ts
```

The fixture is deterministic fake-world evidence, not a production-site benchmark. The
post-eviction warning adds volatile prompt characters on affected steps; its provider-token
impact has not been recertified against G1/G2. The published matrices remain frozen historical
measurements; safety is preferred to silently preserving their exact prompt bytes.
