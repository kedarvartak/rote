# T29 — Enterprise browser contract corpus

## Result

**Fixture contract frozen; product mechanisms remain unsupported.** E7.1 protocol
`p2-enterprise-contract-corpus-v1` defines 19 synthetic positive and fail-closed cases
before E7.2–E7.7 choose implementations. Deterministic schema/oracle tests pass, and two complete
real-Chrome control repetitions passed in 4.9 seconds:

```text
Test Files  1 passed (1)
Tests       2 passed (2)
```

The Chrome smoke directly manipulated fixture controls. It does **not** show that Rote can
yet identify repeated-grid targets, traverse frames/shadow roots, dispatch the new action
vocabulary, consume authoritative evidence, survive a long SPA, or resume a workflow.
Those claims remain gated by #128–#133.

## Frozen scope

The corpus contains:

- 19 cases across repeated/virtualized grids, nested same/cross-origin frames, nested
  open/closed shadow roots, complex controls, authoritative evidence, single-session SPA
  endurance, and multi-session continuation;
- deliberate role/name/depth collisions, ambiguity, stale frame remounts, no-op plus
  unrelated DOM mutation, stale evidence, task-mismatched evidence, and restart mismatch;
- exact external server events with task binding, reset generation, target keys, and
  canonical payload SHA-256 values for every server-backed positive; raw dispatched values
  are discarded rather than returned by the oracle;
- an exact filename and content SHA-256 for the browser-download positive;
- typed failure classifications with `dispatch_count: 0` for every negative;
- exactly 60 single-session SPA transitions, 12 remount epochs, route changes, virtual
  rows, background requests, and a separately reported three-checkpoint/two-restart
  continuation case;
- `claims_allowed: []`, synthetic data only, and explicit prohibition of harness
  conclusion, generic DOM change, stale evidence, or another task's evidence as success.

## Method

Environment: Chromium `150.0.7871.128 snap`, viewport 1,440×900 CSS pixels, two random
loopback origins, no provider and no credentials.

```bash
npm test --workspace @rote/bench -- enterprise-contract enterprise-oracle
npm run test:enterprise-chrome --workspace @rote/bench
```

The browser smoke performed two byte-equivalent grid loads, queried exact state outside
the DOM, exercised the cross-origin frame content directly, checked nested open/closed
shadow fixture boundaries, triggered hover/chord/upload/drag controls, confirmed the no-op
created no authoritative event despite a DOM mutation, completed all 60 SPA events, and
reopened Chromium twice between continuation checkpoints. Exact task-filtered oracle state
survived those browser restarts.

## Reproduction and limitations

The frozen protocol is
[`scripts/bench/enterprise/protocol.json`](../../scripts/bench/enterprise/protocol.json),
with setup and reset instructions in
[`scripts/bench/enterprise/README.md`](../../scripts/bench/enterprise/README.md).
CI parses every category/control, tests the authoritative server, and runs both explicit
Chrome repetitions; missing Chrome fails that contract step rather than silently skipping it.

This is qualification-fixture evidence only. It supports no efficiency, reliability,
production-generality, provider, enterprise-readiness, continuation, or learned-memory
claim. E7.2 is next: identity v2 must pass the frozen repeated-grid collision/remount cases
without changing their oracles.
