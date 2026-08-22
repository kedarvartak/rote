# T42 — Settle priors through the whole product path

**Date:** 2026-08-22
**Milestone:** P2 item 11 (site memory — settle priors, #168)
**Source:** `packages/site-memory/test/cdp-settle-priors-end-to-end.test.ts` (`npm run test:settle-chrome`); CI step "Settle-prior end-to-end Chrome control"

## Question

#168 built the settle-prior pipeline in pieces, each unit-tested: the settledness
gate exposes its last measured settle, the agent records `settle_ms` per dispatched
step, derivation aggregates nearest-rank percentiles. Do the pieces compose through
the *whole* product path — real Chrome, `SettledBrowserPageSession`, the agent loop,
the crash-safe recorder, `loadRecordedRun`, `deriveSiteMemory` — with zero LLM calls?

## Method (deterministic, zero LLM, no provider key)

One scripted-planner run of the frozen B2 vendor form in real headless Chrome: nine
dispatched actions (7 fills, 1 select, 1 click) through a settle-gated session,
recorded with `FileBrowserAgentRunRecorder` to a temp base dir, verified against the
fixture confirmation, then loaded back and derived.

Asserted:
- all 9 dispatched steps carry a measured, non-negative `settleMs`; the terminal
  `done` carries none;
- the recorded run derives `settle_prior` records keyed on the form's 16-hex page
  key: `fill` with 7 samples, `select` with 1, `click` with 1;
- each prior satisfies p50 ≤ p90 ≤ max.

## Result

Pass in ~4 s locally and in CI. This is the fake-planner twin of what a billed
`rote run` records on every step: the billed campaign only swaps the scripted
planner for the model, so settle priors accumulate on real pages with no further
mechanism work.

## What this does not claim

Settle *values* on the fixture server are near-zero and say nothing about real-site
settle distributions; the numbers become meaningful only on billed real-page runs.
The claim here is composition, not magnitude.
