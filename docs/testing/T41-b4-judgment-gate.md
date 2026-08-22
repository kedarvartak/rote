# T41 — B4 triage fixture and the judgment gate

**Date:** 2026-08-22
**Milestone:** P2 (docs/03 task suite: B4 "Triage: read, categorize, route — includes a judgment gate")
**Source:** `fixtures/sites/b4-triage.html`; `packages/distiller/test/invariants/b4-judgment-gate.test.ts`; `packages/executor/test/cdp-b4-triage-control.test.ts`

## Question

B4 was the last unbuilt row of the docs/03 task suite. Its point is not another replay
win — it is the *limit* of replay: the category a support item is routed to is decided
per item from its content. What stops a playbook distilled from one triage run from
freezing that run's category and replaying it against every future item — silently wrong
at volume (invariant 1)?

## What was built

- **`fixtures/sites/b4-triage.html`** — a frozen static triage page. `?item=<id>`
  selects one of three items whose body text determines the correct category
  deterministically (duplicate-payment refund → `billing`; unrecognized-device
  compromise → `security`; crashing export → `bug_report`). Routing renders the exact
  confirmation `Item routed | item=<id> | category=<value>` — the external oracle.
- **No new mechanism.** The judgment gate is the distiller's existing fail-closed
  parameterization: a dispatched value that matches no declared param aborts
  distillation with `UnparameterizedValueError` (default `literalValues: 'fail'`).
  This test suite is what makes that behaviour B4's gate, deliberately.

## Method (deterministic, zero LLM calls, no provider key)

1. **Distiller invariant suite** (`b4-judgment-gate.test.ts`), fake-world:
   - a recorded B4 trajectory whose `select` value (`billing`) came from planner
     judgment distills → `UnparameterizedValueError` naming `select_category` and
     never containing the category value;
   - with the explicit `literalValues: 'allow'` opt-in, the frozen playbook contains
     the literal `billing` and **no** `category` param — the exact artifact the
     default forbids (TKT-1042, a security compromise, would be routed to billing);
   - with `category` declared as a param, distillation emits `{{category}}` — the
     caller owns the judgment per run.
2. **Real-Chrome control** (`cdp-b4-triage-control.test.ts`, `ROTE_RUN_CDP_TESTS=1`):
   static and CDP captures derive identical select/submit contracts on the fixture;
   selecting `billing` and clicking Route for TKT-1041 reaches the exact confirmation
   through `BrowserToolCaller` with zero LLM calls; the item body the judgment reads
   is present before any action.

## Result

All suites pass locally and in CI (the Chrome control runs in the existing
`Action-contract gate + B6 false-match Chrome contract` CI step's script). B4's row in
docs/03 moves from "specified, not yet built" to built-with-gate-certified.

## What this does not claim

- No live model has triaged the fixture; the judgment itself (reading the body and
  choosing the category) is exercised only as a declared-param replay. A billed run of
  B4 through `rote run` — cold judgment, warm replay with a per-run `judgment`-tagged
  category decision — is part of the pending exit-gate campaign.
- The three-item corpus is deliberately minimal; it exists to pin the gate, not to
  measure triage accuracy.
