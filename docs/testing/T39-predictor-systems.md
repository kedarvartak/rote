# T39 — Predictor systems v1: ensemble, calibration, shadow mode

**Date:** 2026-08-16  
**Milestone:** P2 item 10 (predictor — systems work after the T38 kill gate)  
**Source:** `@rote/predictor`; frozen kind+target data sets from T13/T20/T21/T25/T26; `docs/testing/data/T39-predictor-simulation.json`

## Question

T38 passed the kill gate with a history-only trace matcher. Before P3 may *act* on a
prediction it needs three more things: a runtime component (built once per task, queried
per step), an explainable confidence whose calibration is measured rather than assumed,
and a way to accumulate the real-page hit rate T38 could not measure offline. This report
freezes v1 of each.

## What was built

- **Ensemble** (`NextActionPredictor`): trace match first (agreement among the longest
  matching suffixes, discounted for short matches and thin support), an order-2/1
  transition model with add-one smoothing when no suffix matches, first-action fallback
  last. Confidence is a monotone score in [0, 1], not a probability.
- **Offline simulation** (`simulatePredictor`): leave-one-run-out per task, every step;
  hit rate, per-source rates, calibration buckets (confidence → observed hit rate), and
  coverage/precision at thresholds 0.5–0.95.
- **Shadow mode**: `runBrowserAgent({ predictor })` consults the predictor with the
  value-free history before every planner call, scores the answer against the planner's
  action, records `BrowserAgentStep.prediction` and a `predictionSummary`, and never
  dispatches it. `rote run` builds the predictor from earlier successful runs of the same
  task text and environment fingerprint and prints `shadow predictor: h/n steps agreed`.

## Results (offline, frozen kind+target corpus, 1,520 warm steps, 189 runs)

| Metric | Value |
|---|---:|
| Hit rate (ensemble) | 99.4% (1,511/1,520) — identical to T38's trace matcher, as expected on this corpus |
| Trace-source steps / hit rate | 1,516 / 99.7% |
| First-action fallback steps / hit rate | 4 / 0% |
| Coverage @ confidence ≥ 0.9 | 62.4% of steps, precision 99.8% |
| Coverage @ ≥ 0.95 | 62.2%, precision 100% |
| Calibration 0.2–0.4 bucket | 381 steps, observed 98.7% (mean confidence 0.33) |
| Calibration 0.6–0.8 bucket | 175 steps, observed 98.9% (mean 0.67) |
| Calibration 0.8–1.0 bucket | 964 steps, observed 99.8% (mean 0.998) |

## Honest reading

- **The confidence is badly under-calibrated on this corpus** — 0.33 means ~99% here.
  That is the corpus, not a virtue: fixture procedures are near-deterministic, so even a
  one-run, one-step match is almost always right. The score is deliberately conservative
  (short matches and thin support are discounted) so that on real pages, where the same
  evidence is weaker, it does not overstate. Calibration must be re-measured on live
  runs before any threshold is chosen for speculation.
- **The real-page number is now collected automatically**: every `rote run` of a task
  with earlier successful runs records shadow predictions per step. The T38 condition
  ("measure kind+target on real pages before speculation ships") is satisfied by running
  the product, not by a separate campaign — but it still requires provider-billed runs.
- Nothing dispatches on a prediction. P3's session virtualizer and safety fence remain
  unbuilt and gated behind the P2 exit.

## Reproduce

```bash
npx vitest run packages/predictor/test/predictor.test.ts   # recomputes T39-predictor-simulation.json
```
