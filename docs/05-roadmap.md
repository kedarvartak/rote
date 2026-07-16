# 05 — Roadmap

> Living plan, 2026-07. Durations are effort estimates, not promises. **Gates are
> promises.** Every phase ends in a public launch or a killed hypothesis — never a
> silent fade.
>
> Assumptions, so slips are diagnosable: 1–3 builders, OSS-first, quarters from 2026-Q3.

## The arc

| Phase | Theme | Launch headline | Target |
|---|---|---|---|
| **P0** ✅ | Foundations | — (internal) | done |
| **P1** ◀ | **V1: the cheapest loop** | "Same tasks, fraction of the tokens — reproducible" | 2026-Q3 |
| P2 | V2: the harness that learns | "Your 50th task on a site costs a fraction of your 1st" | 2026-Q4 |
| P3 | V3: faster than the model thinks | "Warm flows bounded by think-time only" | 2027-Q1 |
| P4 | Fleet & enterprise | "10K tasks/day, audited, lowest $ per task" | 2027-Q2–Q3 |
| P5 | Platform | "The efficiency substrate other agents build on" | 2027-Q4+ |

Cross-cutting, never a phase: invariants & test discipline, benchmark cadence,
community/OSS, docs-as-constitution.

---

## P0 — Foundations ✅

Core schemas + Expect DSL, lossless recorder, verified replay executor, benchmark matrix
+ per-source accounting. Carries forward unchanged.

## P1 — V1: the cheapest loop ◀ *we are here*

A working OSS browser agent whose observation and context economics beat the incumbents,
proven by a reproducible head-to-head.

V1 launches on the **deterministic** wins (perception, context layout, accounting,
verified replay). The probabilistic ones (routing, speculation, learned memory) are
deliberately V2+: they need calibration time and would delay the number without changing
its headline. A launch *cadence* beats one bigger launch.

### In / out

| In V1 | Deferred |
|---|---|
| CDP browser backend | remote backends beyond a connect string (P2) |
| Distillation, element detection, stable IDs | task-focused filtering (P2), WebMCP (P3) |
| **Diff observations + token budgeter** — the headline | cross-step dedup |
| Cache-layout-owning context assembler | compaction, routing (P2), prediction hints |
| Settledness, self-healing resolution v0 | memory-ranked resolution, batched fill (P2) |
| Live expect checks + verify gate | automated distillation (P2) — V1 replays hand-written playbooks |
| Always-on recording, replay fast path | subflows, drift tracker |
| Per-source token + latency accounting | efficiency-regression CI (post-launch) |
| Head-to-head benchmark + raw data | live-site continuous eval |

The two hardest cuts: **speculation** is the deepest differentiator but the riskiest
machinery (shadow contexts, promotion atomicity); **routing** depends on unresolved
small-model hosting questions. Both headline later launches.

### Status

| Workstream | State |
|---|---|
| W1 browser + perception capture | ✅ |
| W2 distill, stable IDs, diff, render | ✅ |
| W3 loop + context assembler | ✅ |
| W4 action plane | ✅ — [T1](testing/T1-openai-dry-run.md)'s expect defect fixed (#49/#50) |
| W5 benchmark + the number | machinery ✅ · **number not yet run** |
| W6 launch package | ✗ not started |

**No longer blocking the number:** [#49](https://github.com/kedarvartak/rote/issues/49)
and [#50](https://github.com/kedarvartak/rote/issues/50) are fixed — `expect` is now
optional, the planner omits rather than guesses, and a failed postcondition buys one
scoped repair instead of killing a correct run. B2 went **0/7 → 11/11** on
`gpt-5.6-luna` and `gpt-5.6-sol` at roughly neutral token cost. The matrix would now
measure our efficiency rather than our bug. Still open before the number is meaningful:
[#51](https://github.com/kedarvartak/rote/issues/51) (a malformed planner completion ends
the run) and [#52](https://github.com/kedarvartak/rote/issues/52) (a malformed *optional*
`stableId` is fatal) — both turn a recoverable model slip into a recorded failure, which
lands on success parity the same way #49 did.
[#51](https://github.com/kedarvartak/rote/issues/51)
[#52](https://github.com/kedarvartak/rote/issues/52).

**Blocking the launch:** `packages/cli` is private at `0.0.0` and unpublished, so the
`npx rote run` quickstart does not exist; the README has no number in it; no demo.

### Exit gate

> **Rote wins tokens-per-task at success parity by a margin that survives variance**
> (≥15 runs/harness; bootstrap lower bound above the floor — [03](03-benchmark.md)).
> If it doesn't, we fix or we don't launch on efficiency claims. **No number, no launch.**

### Launch checklist

- [ ] `npx` quickstart works on a clean machine with only an API key
- [ ] Benchmark reproduction is one command; raw JSONL downloadable
- [ ] Every efficiency claim carries a number, units, and a link to method
- [ ] Sacred invariant suite green; CI enforces changelog + lint + tests
- [ ] Known limitations written honestly (no routing/speculation/learning yet)
- [ ] Licence check on competitor comparisons (dependencies, not forks)

## P2 — V2: the harness that learns (~8–10 weeks)

The learning plane goes live; the learning curve becomes the product.

1. **Predictor** — trace matching, transition models, offline simulation. *The kill gate
   comes first and costs no systems work*: **≥70% warm next-action accuracy** on recorded
   runs, or P3's speculation thesis dies early and P2 re-scopes to
   memory-without-prediction.
2. **Distiller v1** — trajectory → playbook: causal pruning, parameterization, assertion
   synthesis. Replaces hand-written playbooks. Gate: distilled playbooks replay the
   fixture suite with zero human edits.
3. **Site memory** — per-fingerprint selector maps, form semantics, page graph,
   settle-time priors, quirks. Append-only, confidence + freshness.
4. **Model routing** — `grounded-routine` on a small model, escalation contract, per-site
   calibration. New `route`/`predict` tags (invariant 5; CLAUDE.md updated same PR).
5. **History compaction** in the context assembler, cache-economics-scheduled.

**Exit gates:** T0 ≥80% reduction at parity *with automated distillation*; **T2 ≥30%**
(the generalization bet — retreat rule if <15%); ≥50% of warm steps off the frontier
model at parity. Gates defined in [03](03-benchmark.md).

## P3 — V3: faster than the model thinks (~8–10 weeks)

Speculation ships; wall-clock becomes the second headline number.

1. **Session virtualizer** — virtual session ↔ live/shadow contexts, storage-state
   cloning, atomic promotion. Soaked under test *before* speculation touches it.
2. **Prefetch speculation** (`pure-read`) — predicted observations pre-fetched and
   pre-diffed during think time.
3. **Shadow speculation + promotion** — safety classifier, effect-boundary fence, an
   adversarial suite that *tries* to trick the classifier, politeness caps.
4. **Pipeline depth + calibration** — multi-step speculation on high-confidence traces;
   auto-quiesce on hit-rate collapse.
5. **Subflow mining** — shared-prefix replay with hand-off.

**Exit gates:** ≥30% end-to-end wall-clock reduction on warm flows at parity; **zero
speculated server-mutating calls across the adversarial suite — ever**; warm flows
think-time-bound.

## P4 — Fleet & enterprise

The buyer shifts from builder to fleet operator; reliability and operability become the
product. Sequenced by design-partner pull.

Recovery ladder v2 (scoped repair agent, patch versioning, rollback) + drift tracker ·
parallel fan-out · auth & profiles (**credentials never in trajectories** — redaction at
the recorder, invariant-grade tests) · injection containment with a published threat
model · certified backends · the observability product ("your top 20 procedures, their
hit rates, and what re-derivation is costing you").

## P5 — Platform

The MCP entry point as a first-class product; a portable playbook/memory format others
can read; the benchmark as an industry-neutral instrument.

## Open questions, tracked honestly

1. **Assertion strength vs brittleness** — over-tight assertions cause spurious repairs;
   loose ones let drift through. **[T1](testing/T1-openai-dry-run.md) turned this from a
   question into a finding**: mandatory model-authored expects were both too tight (a
   correct run fails) and too loose (the ones that pass are tautologies). **Fixed in
   #49/#50** by removing the forcing rather than tuning the strength — asked for
   omission, made a failed expect cost one scoped repair instead of the run, and left the
   ground-truth `verify` gate as the thing that decides success. Both failure shapes were
   symptoms of a mandatory field, not of assertion strength.
   Still open: with expects mostly omitted, per-action checking now rests on the final
   gate alone. Deriving postconditions from the observation diff — which needs no
   prediction and no model call — is [#54](https://github.com/kedarvartak/rote/issues/54).
2. **Small-model hosting** — Fara-class models are self-hostable (7B). Bundled local
   inference or API? Affects adoption friction vs the cost story. Decide in P2 with data.
3. **Matching threshold policy** — how conservative should τ be at launch? Lean:
   conservative (prefer misses) + per-playbook learned thresholds.
4. **Judgment-gate scope** — how much branching can a playbook encode before it is just a
   badly-authored workflow engine? Lean: hard cap (≤2 gates/playbook); tasks needing more
   stay unmemoized.
5. **Python story** — the ecosystem is Python-heavy. Formats are language-neutral; a
   Python SDK over the MCP entry point may be enough. Decide post-P1.
6. **Vision budget** — what fraction of steps genuinely needs vision? Measure; set
   defaults from data, not taste.
7. **Cross-tenant playbook sharing** — large value (learn once per *ecosystem*), serious
   privacy/leakage design problem. Deferred.

Next: [06 — Optimizations](06-optimizations.md)
