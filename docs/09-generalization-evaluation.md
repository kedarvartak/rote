# 09 — Evaluating Generalization: Beyond "Run It Twice"

> Status: design. Extends [03 — Wedge Benchmark](03-wedge-benchmark.md). Doc 03's
> exact-repeat benchmark remains the M3 kill gate; this doc defines how the *generalizing*
> memory tiers ([08 — Architecture](08-browser-memory-architecture.md)) get evaluated
> afterward.

## What changes about the question

Doc 03 asks: *"the same agent, given the same task class twice, should not pay twice."*
That measures tier 1 only. The broader promise is:

> **Tokens per task should fall as a function of the agent's accumulated experience with a
> site — even for tasks it has never done on that site.**

So the headline artifact stops being a single warm-vs-cold ratio and becomes a
**learning curve**: tokens per task (y) against task index (x) over a realistic *stream*
of tasks on a fixed set of sites, with success rate overlaid. Rote's curve must fall;
baseline's stays flat (minus prompt caching, which we control for as in doc 03).

## Transfer matrix

Every task in the stream falls into one cell. Each cell isolates one memory tier:

| Condition | Example | Tier exercised | What must happen |
|---|---|---|---|
| **T0 — repeat**: same task class, same site, new params | B2 again with new vendor values | 1 (replay) | ≥80% token reduction at parity (doc 03 gate, unchanged) |
| **T1 — sibling**: different task, same site, shared prefix | B2 learned → "update vendor bank details" | 2 (subflow) + 3 | Reduction ≥50% of the shared prefix's cold cost |
| **T2 — novel-on-known**: unrelated task, known site | B2 learned → "export vendor list to CSV" | 3 only (advisory) | **≥30% token reduction at parity — the generalization kill gate** |
| **T3 — novel site**: any task, never-seen site | new portal entirely | none | Overhead ≤2% of cold cost; zero interference (Rote must get out of the way) |
| **T4 — near-miss**: superficially similar task that must NOT match | doc 03's B6, generalized | matcher discipline | False-replay rate 0; a stale *hint* is tolerable, a wrong *replay* is not |
| **T5 — drift**: known site, mutated DOM | doc 03's B5 | all + drift tracker | Repair/re-learn per doc 03; additionally: stale facts detected and downgraded, not silently followed |

### Kill gates for the generalization thesis

- **T2 < 15% reduction** (or parity loss) → advisory mode isn't worth its complexity;
  Rote retreats to a replay tool (tiers 1–2 only) and competes on harness-agnosticism
  and verification alone. This is a survivable retreat, not a project kill.
- **Any T4 false replay, or any T5 silently-followed stale fact producing a wrong final
  answer** → design kill, same as doc 03's false-match rule.
- **T3 overhead >2%** → the always-on site brief must become opt-in per site.

## Metrics (adds to doc 03's table)

| Metric | Definition | Why |
|---|---|---|
| **Marginal task cost** | tokens of task *n+1* on a site, as a function of *n* | The learning curve itself; report area-under-curve vs baseline over the whole stream |
| **Break-even task count** | stream position where cumulative Rote cost (incl. distill + advisory overhead) drops below cumulative baseline cost | Honest total-cost accounting — distillation isn't free; expected ~2–4 tasks per site |
| **Observation-token share** | tokens spent on `get_dom`/a11y/screenshot results ÷ total | The thing tier 3 attacks; report before/after (raw observations routinely exceed 20K tokens; enterprise pages 40K–500K) |
| **Hint utility** | fraction of injected brief facts the agent's subsequent actions actually used | Detects brief bloat — a 2K-token brief with 5% utility is overhead, not memory |
| **Hint harm rate** | runs where a followed hint was stale/wrong ÷ runs with hints | Must trend to 0 via confidence decay; any *final-answer* harm is a T4/T5 kill |
| **Exploration calls avoided** | count of observation/navigation calls in baseline run minus Rote run, same task | The intuitive number for the demo ("14 fewer DOM dumps") |
| **Success parity per condition** | success rate vs baseline, *per transfer condition* | Aggregate parity can hide T2 regressions behind T0 wins — never report only the aggregate |

All token numbers cache-adjusted and per-`source`-tagged, as in doc 03 — the report must
show advisory overhead (`matcher`-tagged) as its own line, so "≥30% reduction" is net of
what advising costs.

## Task streams

Two streams, both fully scripted and replayable:

1. **Fake-world stream** (extends the M3 synthetic pack): 3 synthetic sites × ~10 tasks
   each, ordered to hit every transfer condition, with scripted DOM mutations for T5.
   Deterministic, runs in CI, zero flake. This is where the invariant-style gates (T3,
   T4) are enforced as automated tests.
2. **Public-benchmark stream** for external credibility: draw task *streams* (not i.i.d.
   task sets) from **WebArena** (self-hostable — we control drift and can rerun
   identically) and **WorkArena/WorkArena++** (enterprise ServiceNow pages, the
   40K–500K-token observation worst case where tier 3 shines). Report against the
   published Agent Workflow Memory numbers (arXiv 2409.07429: +24.6% relative success on
   Mind2Web, +51.1% on WebArena, +8.9–14.0 points cross-task/-site) — AWM measured
   *success* gains from workflow memory; our claim adds the *cost* axis at parity.
   Avoid WebVoyager as a headline (known judge-agreement and shortcut-task criticisms);
   Online-Mind2Web only for a live-web spot check, since live sites break replayability.

Protocol per stream: baseline agent runs the identical stream without Rote; both sides
get the same model, same prompt caching, same seeds where the harness allows. ×3
repetitions for variance, as doc 03.

## What we deliberately do not claim

- No success-rate *improvement* claims as the headline — parity at lower cost is the
  product. If success improves (AWM suggests it can), report it as a bonus.
- No cross-*site* transfer ("learned acme.com, faster on globex.com") in this phase.
  Invariant 3 (never cross environments) forbids it for replay, and for advisory mode it
  is a research question, not a roadmap item. The docs should say so plainly.
- No open-ended browsing benchmarks (BrowseComp-style research tasks) — out of scope by
  construction, per doc 07.

Next: [10 — Competitive Landscape](10-competitive-landscape.md)
