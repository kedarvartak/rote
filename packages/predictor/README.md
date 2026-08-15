# @rote/predictor

Next-action prediction over recorded runs (roadmap P2 item 10, the systems half after the
T38 kill gate). Pure, dependency-free beyond `@rote/core`: **trace matching** (longest
matching history suffix across prior runs of the task, majority vote, bigram then
first-action fallback), a **transition model** (order-2/1 n-gram with add-one smoothing),
an **ensemble** with an explainable monotone confidence, and an **offline simulation** that
reports hit rate, per-source rates, a calibration table, and coverage/precision at
candidate thresholds. Nothing here dispatches: a prediction is advice, and the agent runs
it in *shadow* mode — scored against the planner's choice, recorded, never acted on.

## Public API

- `actionKeyOf(action)` / `actionTarget(action)` / `actionKeyFromEvent(event)` — the
  value-free `ActionKey` (`{kind, target}`: stable identity ref, else selector; URL path for
  navigate; '' for done). The bench curve recorder uses the same derivation.
- `runsFromEvents(events, taskKey?)` / `runsFromJsonl(text, taskKey?)` — corpus of
  `RecordedRun`s grouped by task key (`defaultTaskKey` strips `-rNN`).
- `predictTrace(history, priors)` → `{ predicted, matchedLength, votes, candidates, fallback }`.
- `buildTransitionModel(runs)` / `predictTransition(history, model)`.
- `NextActionPredictor(priors)` `.predict(history)` → `{ predicted, confidence, source:
  'trace' | 'transition' | 'first_action' | 'none', matchedLength, candidates }`. Confidence is
  a monotone score in [0, 1], not a probability — calibrate it with the simulation.
- `simulatePredictor(runs, { thresholds?, buckets? })` → `PredictorSimulationSummary`
  (leave-one-run-out per task): `hit_rate`, `by_source`, `calibration` buckets,
  `thresholds` (coverage/precision) — what P3 needs to choose a speculation threshold.

## Where it runs

`@rote/agent` accepts `predictor` and records `BrowserAgentStep.prediction`
(`{predicted?, confidence, source, hit}`) plus `predictionSummary`; `rote run` builds one
from earlier successful runs of the same task and environment and prints
`shadow predictor: h/n steps agreed`. See [T39](../../docs/testing/T39-predictor-systems.md).

## Tests

```bash
npx vitest run packages/predictor
```
