# T38 — Predictor kill gate (offline warm next-action accuracy)

**Date:** 2026-08-15  
**Milestone:** P2 item 10 — predictor kill gate (precedes any speculation systems work)  
**Data:** [`data/T38-predictor-gate-summary.json`](data/T38-predictor-gate-summary.json) (recomputed by `packages/bench/test/predictor-gate.test.ts`)

## Question

docs/05 P2 item 10: "**≥70% warm next-action accuracy** on recorded runs, or P3's
speculation thesis dies early and P2 re-scopes to memory-without-prediction." Measured
offline, on already-recorded runs, with no systems work: can a trivial deterministic
predictor — trace matching over prior runs of the same task — guess the next action?

## Method

- **Predictor** `trace-matching-v0` (`@rote/bench` `predictNext`): for the current
  history, find in every prior run of the same task the longest matching history suffix
  ending just before a position; the longest matches vote for their next action; no
  positional match → bigram after the last action → majority first action. No model,
  no observation — history only. This is a floor: any real predictor sees the page too.
- **Evaluation**: leave-one-run-out per task, every step of every run (including `done`);
  tasks with a single run are cold and not scored. Runs are grouped by run id without
  the `-rNN` repetition suffix.
- **Granularity**: full trajectories score **kind + target** (stable id, else selector /
  URL path); the G1 curve records (T9/T10/T11 `*-rote.jsonl`) recorded only the action
  kind, so they score **kind-only** and are reported, not aggregated into the gate.
- **Verdict**: pass iff aggregate kind+target accuracy ≥ 0.70; the Wilson 95% lower
  bound is reported alongside.

## Results

| Data set | Granularity | Runs / tasks | Warm steps | Accuracy | Wilson 95% |
|---|---|---:|---:|---:|---:|
| T13 G2 certification (B1–B3, gpt-4.1-mini live) | kind+target | 54 / 3 | 347 | 97.4% | 95.1–98.6% |
| T20 B2 exact certification | kind+target | 18 / 1 | 180 | 100% | 97.9–100% |
| T21 B5 drift certification (5 mutations) | kind+target | 90 / 5 | 756 | 100% | 99.5–100% |
| T25 paired B2 certification | kind+target | 18 / 1 | 180 | 100% | 97.9–100% |
| T26 post-action evidence (B1–B3) | kind+target | 9 / 3 | 57 | 100% | 93.7–100% |
| **Aggregate (gate)** | **kind+target** | **189 / —** | **1,520** | **99.4%** | **98.9–99.7%** |
| T10 G1 WordPress curve (5 tasks × 15 runs) | kind-only | 75 / 5 | 1,314 | 94.7% | 93.3–95.8% |
| T11 cache-key WordPress curve | kind-only | 75 / 5 | 1,307 | 94.0% | 92.6–95.2% |
| T9 tag-qualification WordPress | kind-only | 15 / 5 | 261 | 93.1% | 89.4–95.6% |

**Verdict: pass** — 99.4% (lower bound 98.9%) against the 70% kill threshold on
kind+target; 93–95% kind-only on the live WordPress runs (per task 90–100%).

## Honest reading

- The kind+target corpus is fixture-heavy: B1–B3 and the B5 mutations are short,
  near-deterministic procedures a live planner reproduces almost identically, so 99.4%
  is optimistic. The WordPress runs carry real provider variability (10–26 steps, retries,
  reformulations) and still predict 93–95% by verb — but they did not record targets, so
  the whole-action number for a real portal is **not** yet measured.
- The gate is therefore passed on the evidence that exists, with one condition carried
  into predictor work: record `stableId`/selector per step in future curve runs so the
  next measurement is kind+target on real pages before speculation ships.
- Trace matching sees only history; a predictor with the observation can only do better.
  This is why the floor clearing 70% comfortably is meaningful.

## Reproduce

```bash
npx vitest run packages/bench/test/predictor-gate.test.ts
```
