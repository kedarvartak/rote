# T34 — Single-session SPA endurance certification

**Date:** 2026-08-15  
**Milestone:** P2 / E7.6  
**Source:** issue #132; E7.1 protocol `p2-enterprise-contract-corpus-v1`, case `E7-SPA-60`  
**Data:** [`data/T34-endurance-certification.json`](data/T34-endurance-certification.json)

## Question

Does the product loop — `runBrowserAgent` over a settled CDP page with the frozen B4
compaction policy, adaptive observation eviction, and the E7.4 evidence gate — complete a
60-transition single-session SPA workflow (route pushes, remount epochs, virtualized
controls, background traffic) in 15 fresh runs with exact authoritative verification, no
silent-wrong outcome, and bounded context, settle time, and recorder growth?

This is deterministic mechanism certification with a zero-token scripted planner that only
copies identity from the current observation. It is **not** a provider-economics
measurement (no LLM tokens were spent), not multi-session continuation across a
browser/process restart (E7.7, #133), and not structural action-contract compatibility
(#143).

## Contract

- **Document epochs, not URL epochs.** `CapturedPage.documentToken` (hash of the CDP
  loader id) distinguishes a same-document `pushState` route change from a document load.
  The loop resets the observation diff base only when the document changes; a route push
  is rendered as a diff against the retained base and recorded as
  `pageTransition: {routeChanged: true, documentChanged: false}`. Backends without a
  token fall back to URL identity (previous behavior).
- **No dispatch to a stale identity.** A stable identity the run has already dispatched
  to, and which is absent from the current capture, may rebind only through an exact
  identity match (`stable-id`, or `role-name` for a remount that moved the same control).
  A fuzzy `text-proximity`/`selector` rebind — "Advance transition 3" healing onto
  "Advance transition 4" after remount — is `ElementResolutionStaleIdentityError` before
  dispatch: one grounded repair, else fatal.
- **Bounded settledness under background traffic.** A request the server has answered but
  not finished (SSE, long-poll body, unread fetch body) is `streamingResponses`, not
  `pendingRequests`; every network edge (start/response/data/finish) bumps
  `networkVersion`, which resets the quiet window like a DOM mutation. The frozen policy
  `ENDURANCE_SETTLEDNESS_POLICY` = quiet 150 ms, poll 25 ms, timeout 5,000 ms, one
  tolerated unanswered background request. Exceeding it is a typed
  `SettlednessTimeoutError`, never a hang.
- **Bounded history and context.** Default B4 policy (24/16/8/8): planner-visible actions
  ≤ 31 (8 representatives + 23 exact tail before the next boundary), 3 compaction
  boundaries per 60-action run, each an honest planner-history cache miss. Successive
  post-boundary volatile-suffix peaks may not climb by more than 5%.
- **Eviction exercised, not merely available.** Observation budget 500 chars is below the
  fixture's ~600-char full snapshot, so step 0 pays one explicit bootstrap base and every
  later transition must render as a diff.
- **Authoritative only.** Success requires the UI status *and* the fixture oracle's
  60 `spa_transition` events with the protocol's frozen payload digests, in order; the
  planner's `done` and DOM churn are prohibited success signals.

## Certification (15 fresh runs, real Chromium)

| Check | Result |
|---|---:|
| Fresh runs (own page target + own fixture server/oracle generation) | 15/15 succeed |
| Transitions per run / exact oracle events / dispatches | 60 / 60 exact digests / 60 |
| Route changes per run / document changes | 60 / 0 |
| Max planner-visible actions vs policy bound | 31 / 31 |
| Compaction boundaries per run (cache misses) | 3 (at 16, 32, 48 compacted actions) |
| Peak-to-peak volatile suffix growth across boundaries | 1.1% (limit 5%) |
| Max context (stable prefix + volatile suffix) | 8,120 chars |
| Budgeted observation max / bootstrap snapshots | 412 chars ≤ 500 / 15 (one base per run), max 562 chars |
| Post-base steps served as diffs | 100% (60/60 per run) |
| Settle timeouts / slowest settle / total settle per run (max) | 0 / 234 ms / 12,012 ms |
| Recorder growth, last-third vs middle-third bytes per step | 1.06× (limit 1.25×); 86,146 bytes per 60-step run |
| Wall clock per run (60 transitions) | ≈13 s |
| Stale identity replay at step 3 (remounted "Advance transition 3") | rejected pre-dispatch, 1 grounded repair, 60 dispatches, exact oracle |
| Long-lived unanswered background request, tolerance 0, timeout 1,000 ms | typed `SettlednessTimeoutError` on first action |
| Same request, frozen policy (tolerance 1) | 60/60 transitions, exact oracle, 0 timeouts |

`certifyEndurance` (pure, `@rote/bench`) computes every check from the recorded per-step
samples; the stored data set is re-certified by a unit test so the table above cannot
drift from the certifier silently.

## What this does not claim

- No provider tokens were spent: the B4 **economic** claim (cost/latency over 50+ steps
  with real cache accounting) is still open and needs a provider-billed run.
- The fixture is the frozen synthetic E7.1 SPA, not a production application.
- Continuation across browser/process restart is E7.7 (#133); the same-looking control
  whose *contract* changes is #143.

## Reproduce

```bash
npx vitest run packages/agent/test/invariants/spa-endurance-fail-closed.test.ts \
  packages/action/test/settledness.test.ts packages/bench/test/enterprise-endurance.test.ts
npm run test:enterprise-endurance-chrome --workspace @rote/bench   # requires Chrome/Chromium, ≈75 s
```

CI runs the Chrome certification explicitly.
