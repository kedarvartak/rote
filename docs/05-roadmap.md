# 05 — Roadmap

> Living plan, 2026-07. Durations are effort estimates, not promises. **Gates are
> promises.** Every phase ends in a public launch or a killed hypothesis — never a
> silent fade.
>
> Assumptions, so slips are diagnosable: 1–3 builders, OSS-first, quarters from 2026-Q3.

## The arc

Sequenced by **memory tier** ([02 §The memory spine](02-architecture.md)) — V1 is tier 0,
the only tier where nobody else is building.

| Phase | Theme | Tier | Launch headline | Target |
|---|---|---|---|---|
| **P0** — done | Foundations | — | — (internal) | done |
| **P1** — *here* | **V1: working memory** | **0** | **"The first browser agent with a managed context window"** | 2026-Q3 |
| P2 | V2: the harness that learns | 1, 2 | "Your 50th task on a site costs a fraction of your 1st" | 2026-Q4 |
| P3 | V3: faster than the model thinks | 2 | "Warm flows bounded by think-time only" | 2027-Q1 |
| P4 | Fleet & enterprise | — | "10K tasks/day, audited, lowest $ per task" | 2027-Q2–Q3 |
| P5 | Platform | — | "The efficiency substrate other agents build on" | 2027-Q4+ |

**Why tier 0 first, when tier 1 is the original thesis:** tier 1 is table stakes — Skyvern
already ships record → codegen → zero-LLM replay → fallback ([04](04-competition.md)).
Building the distiller first reaches parity and passes nothing. Tier 0 is where the
exponent lives, no competitor is there, it needs no site cooperation, and it pays even on
tasks that never recur. It is also the only tier we can measure this quarter.

Cross-cutting, never a phase: invariants & test discipline, benchmark cadence,
community/OSS, docs-as-constitution.

---

## P0 — Foundations (done)

Core schemas + Expect DSL, lossless recorder, verified replay executor, benchmark matrix
+ per-source accounting. Carries forward unchanged.

## P1 — V1: working memory *(we are here)*

**A browser agent that manages its context window, and a curve that proves it.**

Everyone re-sends the transcript every step, so every harness is O(n²) in task length.
Every optimization the field competes on lowers the *constant*. V1 attacks the *exponent* —
four levers, on tier 0, where the capability matrix is an empty column for the whole field.

V1 launches on the **deterministic** wins (working memory, accounting, verified replay).
The probabilistic ones (routing, speculation, learned memory) are deliberately V2+: they
need calibration time and would delay the number without changing its headline. A launch
*cadence* beats one bigger launch.

### The tier-0 four

| Lever | Effect on the curve | State |
|---|---|---|
| **A11 observation eviction** | kills the dominant quadratic term | **built** — and never claimed. Growth is 35 tok/step (one action JSON), not 135+ |
| **A4 diff observations** | −~90% on the constant, real pages | **built and measured** — 849 WordPress certification diffs show 99.6% median render-size reduction vs. their preceding grounded bases ([T10](testing/T10-g1-cumulative-token-curve.md)) |
| **B3 cache layout** | 10× off the surviving quadratic | **built, minimally qualified** — T4 repeats a 1,024-token incremental hit in 2/2 verified runs; hit-rate and dollar impact remain unmeasured |
| **B4 compaction** | history → O(1); **curve → linear** | not built |

**Measure before building.** G1 now exercises A11/A4 on WordPress and reports B3 cache
buckets without relabeling cache reads as savings. B4 remains deferred: the measured curve
already clears G1, while compaction fights cache-prefix stability and needs scheduling.

### In / out

| In V1 | Deferred |
|---|---|
| **The curve**: cumulative tokens vs. steps, vs. Browser Use, on a real page — the headline | live-site continuous eval |
| ~~#57 cache accounting~~ — **done**; it was the prerequisite, so it shipped first | — |
| A11 eviction (built) + A4 diff proven on a real page | cross-step dedup (A10), task-focused filtering (P2) |
| B3 cache layout: qualify OpenAI automatic prefix hits + cache-aware accounting | B4 compaction (P2 — fights B3, needs scheduling) |
| CDP browser backend | remote backends beyond a connect string (P2) |
| Distillation, element detection, stable IDs, token budgeter | WebMCP (P3 — no site implements it; see [04](04-competition.md)) |
| Settledness, self-healing resolution v0 | memory-ranked resolution, batched fill (P2) |
| Live expect checks + verify gate | automated distillation (P2) — V1 replays hand-written playbooks |
| Always-on recording, replay fast path | subflows, drift tracker |
| Per-source token + latency accounting | efficiency-regression CI (post-launch) |
| Head-to-head benchmark + raw data | routing, prediction hints (P2) |

The hardest cuts: **the distiller** is the original thesis and is now known to be tier-1
catch-up — Skyvern ships it, so it headlines V2 rather than V1. **Speculation** is the
deepest differentiator and the riskiest machinery (shadow contexts, promotion atomicity).
**Routing** depends on unresolved small-model hosting questions.

### Status

| Workstream | State |
|---|---|
| W1 browser + perception capture | done |
| W2 distill, stable IDs, diff, render | **done and real-page measured** — T10 records 849 WordPress diffs and their grounded-base ratios |
| W3 loop + context assembler | **done, including minimally qualified OpenAI history-first layout** — one incremental hit per T4 run; accounting remains provider-normalized (#57) |
| W4 action plane | done — [T1](testing/T1-openai-dry-run.md)'s expect defect fixed (#49/#50) |
| W5 benchmark + the number | **G1 done** — 37.2% slower logical-input growth (95% CI 35.6–38.8%) at 75/75 success parity per harness; G2 remains |
| W6 launch package | not started |
| **W7 working memory (new)** | #57 accounting **done** → curve exploration **done** → OpenAI cache mechanism **qualified** → measure economics → compaction. The V1 headline |

**No longer blocking the number:** [#49](https://github.com/kedarvartak/rote/issues/49)
and [#50](https://github.com/kedarvartak/rote/issues/50) are fixed — `expect` is now
optional, the planner omits rather than guesses, and a failed postcondition buys one
scoped repair instead of killing a correct run. B2 went **0/7 → 11/11** on
`gpt-5.6-luna` and `gpt-5.6-sol` at roughly neutral token cost. The matrix would now
measure our efficiency rather than our bug. [#51](https://github.com/kedarvartak/rote/issues/51) and
[#52](https://github.com/kedarvartak/rote/issues/52) are now fixed: malformed planner
output gets one scoped, accounted corrective call, while a malformed optional `stableId`
is dropped with a recorded classification into the existing semantic resolution chain.
Both still fail closed when no safe action can be resolved. The known planner-boundary
robustness defects no longer block an honest success-parity measurement.

**Blocking the launch:** `packages/cli` is private at `0.0.0` and unpublished, so the
`npx rote run` quickstart does not exist; the README has no number in it; no demo.

### Exit gate

Two gates. The first is the headline; the second keeps the first honest.

> **G1 — the curve.** Cumulative tokens grow **materially slower with task length** than
> the baseline harness, at success parity, on a real page — measured on the provider's own
> cache accounting, not ours. Published as a graph with raw JSONL.
>
> **G2 — the level.** Rote wins tokens-per-task at success parity by a margin that
> survives variance (≥15 runs/harness; bootstrap lower bound above the floor —
> [03](03-benchmark.md)).

**No number, no launch.** If G1 fails, the memory thesis is wrong and we say so — it costs
one benchmark, which is the point of running it before building. G2 alone is the old gate:
a fight on the axis where we are late, against harnesses with years of head start on the
same idea ([04](04-competition.md)). Lead with G1.

**G1 threshold: at least 30% slower cumulative logical-input growth**, certified only when
the 95% seeded-bootstrap interval's lower bound clears 30% at success parity. This was set
from the first certification matrix, before any optimization against its result: v8
measured 37.2% (95% CI 35.6–38.8%) over 15 complete matched repetitions ([T10](testing/T10-g1-cumulative-token-curve.md)). The rounded floor leaves a visible margin below the first point estimate while remaining materially larger than noise.

### Launch checklist

- [ ] `npx` quickstart works on a clean machine with only an API key
- [ ] Benchmark reproduction is one command; raw JSONL downloadable
- [x] Every published G1 efficiency claim carries a number, units, and a link to method
- [x] **The curve is a graph in the README**, with the method and the raw data
- [x] **#57 closed** — cache accounting is provider-normalized (uncached / cache-read / cache-write), priced per bucket, property-tested against both providers
- [ ] Sacred invariant suite green; CI enforces changelog + lint + tests
- [ ] Known limitations written honestly (no routing/speculation/learning yet; **no
      distiller — tier 1 is V2**; eviction trades recall for cost)
- [ ] Licence check on competitor comparisons (dependencies, not forks)

## P2 — V2: tiers 1 and 2, the harness that learns (~8–10 weeks)

Episodic and semantic memory go live; the learning curve becomes the product. **This is
catch-up on tier 1 and a lead on tier 2** — Skyvern ships the former, nobody ships the
latter ([04](04-competition.md)). Sequenced after V1 because tier 0 is where we are alone
and tier 1 is where we are behind; parity is worth less than a position.

1. **History compaction** (B4) — finishes tier 0. The only lever that turns the curve from
   a smaller quadratic into a **linear** one. Cache-economics-scheduled, because it fights
   B3 by construction: compaction mutates the prefix caching needs immutable, so compact
   every ~*k* steps and eat one miss. Listed first because it completes V1's headline
   rather than starting a new one.
2. **Distiller v1** (tier 1) — trajectory → playbook: causal pruning, parameterization,
   assertion synthesis. Replaces hand-written playbooks. Gate: distilled playbooks replay
   the fixture suite with zero human edits. **Reaches parity with Skyvern's 2026 baseline;
   the differentiator is the verification contract, not the distillation.**
3. **Predictor** — trace matching, transition models, offline simulation. *The kill gate
   comes first and costs no systems work*: **≥70% warm next-action accuracy** on recorded
   runs, or P3's speculation thesis dies early and P2 re-scopes to
   memory-without-prediction.
4. **Site memory** (tier 2) — per-fingerprint selector maps, form semantics, page graph,
   settle-time priors, quirks. Append-only, confidence + freshness. Advisory only: it
   *informs*, never *executes*, so it can be wrong without being dangerous. Its brief is
   tier-0 content and must live inside the token budget — a 2K brief at 5% utility is
   overhead, not memory.
5. **Model routing** — `grounded-routine` on a small model, escalation contract, per-site
   calibration. New `route`/`predict` tags (invariant 5; CLAUDE.md updated same PR).

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
