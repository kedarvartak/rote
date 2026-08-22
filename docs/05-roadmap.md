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
| **P1** — done | **V1: working memory** | **0** | **"The first browser agent with a managed context window"** | launched 2026-08-08 |
| **P2** — *here* | V2: the harness that learns | 1, 2 | "Your 50th task on a site costs a fraction of your 1st" | 2026-Q4 |
| P3 | V3: faster than the model thinks | 2 | "Warm flows bounded by think-time only" | 2027-Q1 |
| P4 | Fleet & enterprise | — | "10K tasks/day, audited, lowest $ per task" | 2027-Q2–Q3 |
| P5 | Platform | — | "The efficiency substrate other agents build on" | 2027-Q4+ |

**Why tier 0 first, when tier 1 is the original thesis:** tier 1 is table stakes — Skyvern
already ships record → codegen → code replay with automatic fallback ([04](04-competition.md)); T23 shows the zero-reasoning path is not universal.
Building the distiller first reaches parity and passes nothing. Tier 0 is where the
exponent lives, no competitor is there, it needs no site cooperation, and it pays even on
tasks that never recur. It is also the only tier we can measure this quarter.

Cross-cutting, never a phase: invariants & test discipline, benchmark cadence,
community/OSS, docs-as-constitution.

---

## P0 — Foundations (done)

Core schemas + Expect DSL, lossless recorder, verified replay executor, benchmark matrix
+ per-source accounting. Carries forward unchanged.

## P1 — V1: working memory *(launched 2026-08-08)*

**A browser agent that manages its context window, and a curve that proves it.**

The naive loop re-sends the transcript every step — O(n²) in task length. The field's
answer is eviction, and the major harnesses now ship it ([04](04-competition.md)); what
everyone still does is re-send a **full render of the current page** every step. V1
manages the whole window — evict, diff, budget, enforce cache layout — where the field
ships eviction alone, and the diff row of the capability matrix is empty for everyone
but us.

V1 launches on the **deterministic** wins (working memory, accounting, verified replay).
The probabilistic ones (routing, speculation, learned memory) are deliberately V2+: they
need calibration time and would delay the number without changing its headline. A launch
*cadence* beats one bigger launch.

### The tier-0 four

| Lever | Effect on the curve | State |
|---|---|---|
| **A11 observation eviction** | kills the dominant quadratic term | **built** — and never claimed. Growth is 35 tok/step (one action JSON), not 135+ |
| **A4 diff observations** | −~90% on the constant, real pages | **built and measured** — 849 WordPress certification diffs show 99.6% median render-size reduction vs. their preceding grounded bases ([T10](testing/T10-g1-cumulative-token-curve.md)) |
| **B3 cache layout** | discounted provider billing on the surviving prefix | **built and economically qualified on OpenAI** — deterministic immutable-prefix routing cuts WP-N25 Rote cost 20.5% and clears Browser Use by 16.0% ([T11](testing/T11-cache-key-economics.md)) |
| **B4 compaction** | action history → O(1) in steps; cumulative action-history input → O(n) | **built deterministically; long-run provider/SPA qualification pending** — exact 24-action prefix, 16-action boundaries, at least eight exact recent actions, provenance-only representatives |

**Measure before building.** G1 now exercises A11/A4 on WordPress and reports B3 cache
buckets without relabeling cache reads as savings. B4 subsequently landed first in P2
under the explicit #107 implementation waiver; the measured P1 curve remains frozen, and
long-run cache economics stay unclaimed until E7.6.

### In / out

| In V1 | Deferred |
|---|---|
| **The curve**: cumulative tokens vs. steps, vs. Browser Use, on a real page — the headline | live-site continuous eval |
| ~~#57 cache accounting~~ — **done**; it was the prerequisite, so it shipped first | — |
| A11 eviction (built) + A4 diff proven on a real page | cross-step dedup (A10), task-focused filtering (P2) |
| B3 cache layout: qualify OpenAI automatic prefix hits + cache-aware accounting | B4 long-run provider/SPA qualification (mechanism lands first in P2) |
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
| W3 loop + context assembler | **done and OpenAI-economics qualified** — cache-key routing plus immutability guards preserve logical accounting and win long-cell billed cost in T11 |
| W4 action plane | done — [T1](testing/T1-openai-dry-run.md)'s expect defect fixed (#49/#50) |
| W5 benchmark + the number | **done, corrected and refreshed** — T20 restores historical B2/full G2 against Browser Use 0.13.6; T25 separately certifies fresh corrected B2 against 0.13.7 with 83.1% lower logical tokens (95% CI 82.1–83.9%) at 18/18 exact parity per harness |
| W6 launch package | **done** — public `@rotehq/cli@0.1.0`, demo, reproduction, and provider-backed T28 registry smoke |
| **W7 working memory (new)** | #57 accounting **done** → G1/corrected G2/B5 **passed** → registry package/T28 **passed** → deterministic compaction built after 0.1.0 under waiver |

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

**Launch closed:** corrected B2 and deterministic B5 pass
([T20](testing/T20-b2-exact-certification.md), [T21](testing/T21-b5-drift-certification.md)).
`@rotehq/cli@0.1.0` is published; registry metadata/integrity, a no-key bin invocation,
and the provider-backed exact quickstart pass. [T28](testing/T28-registry-provider-quickstart.md)
retains the empty-directory command, manifest, trajectory, and reconciled receipt. The
runnable demo and one-command evidence reproduction are complete; the final gate walk is
recorded in [launch readiness](launch-readiness.md).

### Exit gate

Two gates. The first is the headline; the second keeps the first honest.

> **G1 — the curve.** Cumulative tokens grow **materially slower with task length** than
> the baseline harness, at success parity, on a real page — measured on the provider's own
> cache accounting, not ours. Published as a graph with raw JSONL.
>
> **G2 — the level.** Rote wins tokens-per-task at success parity by a margin that
> survives variance (≥15 runs/harness; bootstrap lower bound above the floor —
> [03](03-benchmark.md)).

**G2 correction:** B1 and B3 retain their v1 exact terminal-state evidence. B2's v1 oracle
proved only generic completion, so its parity and 77.3% reduction claim are withdrawn.
Protocol v2 requires all eight exact values and passes 18/18 attempts per harness with an
83.6% reduction (95% CI 82.7–84.6%) against Browser Use 0.13.6 in T20. Combined with
unchanged B1/B3 evidence, full G2 is restored. Protocol v3 then recollects both harnesses
contemporaneously and certifies corrected B2 against Browser Use 0.13.7 at 83.1%
(95% CI 82.1–83.9%) in T25; it does not rewrite the historical matrix. B5 then passes on deterministic semantic target drift: 72/72 recoverable
attempts succeed exactly, 0/90 silent failures are observed, and 18/18 ambiguous targets
fail closed. It does not claim generic workflow repair.

**No number, no launch.** If G1 fails, the memory thesis is wrong and we say so — it costs
one benchmark, which is the point of running it before building. G2 alone is the old gate:
a fight on the axis where we are late, against harnesses with years of head start on the
same idea ([04](04-competition.md)). Lead with G1.

**G1 threshold: at least 30% slower cumulative logical-input growth**, certified only when
the 95% seeded-bootstrap interval's lower bound clears 30% at success parity. This was set
from the first certification matrix, before any optimization against its result: v8
measured 37.2% (95% CI 35.6–38.8%) over 15 complete matched repetitions ([T10](testing/T10-g1-cumulative-token-curve.md)). The rounded floor leaves a visible margin below the first point estimate while remaining materially larger than noise.

### Launch checklist

- [x] `npx` quickstart works from an empty directory with only an API key ([T28](testing/T28-registry-provider-quickstart.md))
- [x] Benchmark reproduction is one command (`npm run reproduce:g2`); raw JSONL/receipts are downloadable
- [x] Every published G1/G2 efficiency claim carries a number, units, and a link to method
- [x] **The curve is a graph in the README**, with the method and the raw data
- [x] **#57 closed** — cache accounting is provider-normalized (uncached / cache-read / cache-write), priced per bucket, property-tested against both providers
- [x] Sacred invariant suite green; CI enforces changelog + lint + tests
- [x] [Known limitations](known-limitations.md) written honestly (no routing/speculation/learning yet; **no
      distiller — tier 1 is V2**; eviction trades recall for cost)
- [x] [Licence check](third-party-licenses.md) confirms competitor dependencies, not forks

## P2 — V2: tiers 1 and 2, the harness that learns (~14–18 weeks total; ~11–15 remain after E7.3)

Episodic and semantic memory go live; the learning curve becomes the product. **This is
catch-up on tier 1 and a lead on tier 2** — Skyvern ships the former, nobody ships the
latter ([04](04-competition.md)). Sequenced after V1 because tier 0 is where we are alone
and tier 1 is where we are behind; parity is worth less than a position.

### Priority: structural action-contract drift

[#143](https://github.com/kedarvartak/rote/issues/143) is the cross-cutting P2 trust gate.
Cosmetic and selector drift are insufficient: a control can retain an apparent identity
while its required interaction, browsing context, safety class, destination, side effect,
or authoritative outcome changes. Reuse must classify that as `contract_mismatch` before
dispatch rather than treating target resolution as permission to act.

The enterprise order remains binding. Identity v2 provides a trustworthy subject; composed
contexts locate it; authoritative evidence defines the required outcome; action vocabulary
adds versioned affordance/precondition/effect contracts; endurance tests remount and mutate
those contracts; only then may the distiller persist them. The first public demonstration
must show cosmetic redesign continuing, harmless selector/remount drift resolving, and a
same-looking semantic contract change dispatching nothing with clean cold fallback. E7.2
alone is identity infrastructure, **not** structural-drift support.

**Status: the gate is built for replay** ([T35](testing/T35-action-contract-gate.md)):
strict versioned `ActionContract`, pure derivation from capture-time affordance, an
explicit compatibility matrix, pre-dispatch comparison in `BrowserToolCaller` with a
classified `BROWSER_CONTRACT_MISMATCH` fallback, adversarial same-identity fixtures
(input→textarea, changed destination, POST purge behind a fake banner), and contracts
recorded on every live element step. Distiller v1 persists them ([T36](testing/T36-distiller-v1.md)),
and the first public demonstration exists: `npm run demo:action-contract` replays one
recorded procedure against six versions of a page in real Chrome — cosmetic redesign and
rename/remount continue, textarea/destination/POST-purge variants dispatch nothing with a
clean classified fallback, and the purge counter (not the banner) shows what blind replay
would have done ([T35 §Public demonstration](testing/T35-action-contract-gate.md#public-demonstration)).

1. **History compaction** (B4) — **built first under the explicit #107 implementation
   waiver.** Deterministic action-aware compaction bounds planner-visible history while
   preserving an append-only tail between 16-action boundaries, where one cache miss is
   explicit. The mechanism completes tier 0 structurally; T34 certifies 60-step SPA
   endurance under it deterministically, and provider-billed 50+ step economics still
   must be measured before any cost claim.
2. **Freeze the enterprise browser contract corpus — done** ([#127](https://github.com/kedarvartak/rote/issues/127),
   [T29](testing/T29-enterprise-contract-corpus.md)). Nineteen synthetic repeated-grid,
   iframe/open-shadow, control, authoritative-evidence, SPA, and restart cases bind exact
   external outcomes or dispatch-free failures. Direct fixture controls pass in Chrome;
   no product mechanism or enterprise-readiness claim follows.
3. **Version target identity before learning it — built** ([#128](https://github.com/kedarvartak/rote/issues/128)) — v1 hashes role, accessible
   name, and a coarse depth bucket and can collide in repeated grids. Identity v2 hashes
   browsing context and allowlisted composed-container lineage, detects residual ambiguity
   before dispatch, excludes sensitive values, and preserves v1 artifacts append-only.
4. **Composed browsing contexts — built** ([#129](https://github.com/kedarvartak/rote/issues/129),
   [T31](testing/T31-composed-browser-contexts.md)) — CDP capture, diff, resolution, and
   dispatch cross nested same/cross-origin frames and open shadow roots. Stable context
   paths exclude runtime IDs; stale documents, context splicing, duplicate inner controls,
   and declared closed roots stop before mutation.
5. **Authoritative outcome evidence — built** ([#130](https://github.com/kedarvartak/rote/issues/130),
   [T32](testing/T32-authoritative-outcome-evidence.md)) — versioned redacted evidence
   envelopes, a pure policy evaluator, and injected fixture/API/database/download-event
   adapters. UI evidence remains useful support but cannot alone satisfy a task that
   declares an authoritative outcome requirement; missing, stale, other-task, and
   inconsistent evidence fail with typed classifications before any success is reported.
6. **Enterprise action vocabulary — built** ([#131](https://github.com/kedarvartak/rote/issues/131),
   [T33](testing/T33-enterprise-action-vocabulary.md)) — grounded hover, explicit
   normalized keyboard chords, id-referenced allowlisted file upload, and same-context
   target-to-target drag/drop, shared across planner schema, live loop, replay executor,
   and the CDP backend. Every verb lands with safety classification, redaction,
   settledness, and reaction-only evidence semantics; unsupported backends fail typed and
   there is no arbitrary-event escape hatch.
7. **Long-running single-session SPA endurance — built** ([#132](https://github.com/kedarvartak/rote/issues/132),
   [T34](testing/T34-spa-endurance-certification.md)) — 15 fresh real-Chrome runs complete
   the frozen 60-transition SPA contract through the product loop under the default B4
   policy: same-document route pushes keep the diff base (document epochs, not URL
   epochs), planner-visible history stays ≤31 actions with 3 reported compaction
   boundaries, already-dispatched remounted identities are rejected before dispatch,
   settledness is bounded under long-lived background traffic, and success is exact
   authoritative evidence only. Provider-billed B4 economics remain unmeasured; continuation
   across a browser/process restart is #133.
8. **Distiller v1 — built** (tier 1, [T36](testing/T36-distiller-v1.md)) — trajectory →
   playbook, deterministic: dispatch-evidence pruning with reasons, last-write-wins,
   parameterization that refuses undeclared typed values, assertions from strong evidence
   only, and each step's recorded `actionContract` persisted so replay is contract-gated
   ([T35](testing/T35-action-contract-gate.md)). Gate met: B1/B2 record → distill →
   replay in real Chrome with zero human edits and zero model calls; `verify` is learned
   from the declarative checks the run's verifier proved on the terminal `done` (#155),
   refusing runs that cannot teach one. Matcher v1 selects from an append-only library
   (#157): fingerprint hard gate, deterministic intent/param match at a conservative
   threshold, misses on near-miss and ambiguity. The CLI closes the loop (#159):
   `rote distill <run_id>` learns playbook + site memory from a recorded run, `rote run`
   consults the library and renders the site brief, `rote continue` resumes under a
   task id. B6 (docs/03's false-match test) is built and T4 near-miss discipline
   certified with defence in depth ([T40](testing/T40-b6-false-match.md), #162), and B4
   — the suite's judgment-gate row and its last unbuilt task — is built and certified
   deterministically ([T41](testing/T41-b4-judgment-gate.md), #167): a judgment-chosen
   triage category never survives distillation, so the task suite is now complete. Gate:
   distilled playbooks replay the fixture suite with zero human edits. **Reaches parity
   with Skyvern's 2026 baseline; the differentiator is the verification contract.**
9. **Multi-session task continuation — built** ([#133](https://github.com/kedarvartak/rote/issues/133),
   [T37](testing/T37-multi-session-continuation.md)) — append-only, digest-bound task
   checkpoints (`@rote/continuation`) resume an incomplete controlled workflow across
   real browser/process restarts only after the fingerprint hard gate, principal,
   procedure-version, bindings, and authoritative-evidence freshness/state checks all
   pass; completed steps are never dispatched again; interrupted writes recover without
   in-place edits. Credentials and profile management remain P4; continuation is
   reported separately from replay and learned matching.
10. **Predictor — kill gate passed; systems v1 built** — `@rote/predictor` (#160,
    [T39](testing/T39-predictor-systems.md)): trace matching + transition-model
    ensemble with a monotone confidence, offline calibration/coverage simulation, and
    shadow mode in the agent and `rote run` (predictions scored against the planner and
    recorded, never dispatched). Confidence is under-calibrated on the fixture corpus, so
    live calibration is required before any threshold is chosen. *The kill gate came
    first and cost no systems work*:
    **≥70% warm next-action accuracy** on recorded runs, else P3's speculation thesis
    dies early. [T38](testing/T38-predictor-kill-gate.md): a history-only trace matcher
    predicts 99.4% kind+target over 1,520 warm steps of fixture runs and 96.5% by verb
    over 2,805 live WordPress steps (corrected in #154: repairs are not steps) — the
    thesis stays alive, with one condition carried forward: the whole-action number must
    be measured on real pages before speculation ships. Curve runs now record a value-free
    `action_target` per step and the gate scores them kind+target (#154); the
    provider-billed run that produces that data is the remaining half.
11. **Site memory** (tier 2) — per-fingerprint selector maps, form semantics, page graph,
    settle-time priors, quirks. Append-only, confidence + freshness. Advisory only: it
    *informs*, never *executes*, so it can be wrong without being dangerous. **Store built
    (#156)**: `@rote/site-memory` — strict value-free records partitioned by fingerprint
    hash, derived deterministically from recorded runs (the agent now records page-key
    digests per step), consolidated on read with confidence × freshness. Its brief is
    tier-0 content and must live inside the token budget — a 2K brief at 5% utility is
    overhead, not memory. **Brief built (#158)**: `renderSiteBrief` ranks facts by page
    and confidence × freshness under a hard character cap with fixed wording, the agent
    renders it into the cache-stable prefix as a hint, and every run reports hint
    utility (hinted vs dispatched identities). **Settle priors fed (#168)**: the
    settledness gate's measured settle is recorded per step (`settle_ms`) and derivation
    aggregates nearest-rank p50/p90/max per page and action kind, with the coded
    `long_settle` quirk at p90 ≥ 3,000 ms — the schema-without-telemetry gap is closed. Whether it earns its tokens is the T2
    measurement (≥30% at parity; retreat below 15%) — provider-billed, not yet run.
12. **Model routing — v1 built (#161)** — `grounded-routine` on a small model: a
    confident shadow prediction (default ≥ 0.9) routes the step to the `routine`
    planner; the frontier takes every other step, every repair, and every escalation.
    Escalation contract: routine output that fails closed or a target that cannot be
    resolved is re-planned by the frontier before dispatch, spend kept, so the cheap
    model can cost a call, never a wrong action. Per-step `route` and per-run
    `routingSummary` measure "warm steps off the frontier"; `rote run --routine-model
    <model> [--route-min-confidence]` exposes it. `route`/`predict` tags added (invariant
    5; CLAUDE.md updated). Per-site calibration of the threshold — and whether parity
    holds — is the provider-billed measurement, not yet run.

**Exit gates:** T0 ≥80% reduction at parity *with automated distillation*; **T2 ≥30%**
(the generalization bet — retreat rule if <15%); ≥50% of warm steps off the frontier
model at parity. Gates defined in [03](03-benchmark.md).

*Status 2026-08-22:* every P2 item has a built, deterministically certified v1; what
remains for the exit gates is one provider-billed campaign through `rote run`
(T0 with automated distillation, T2 brief utility, routing parity, predictor
calibration on real pages, B4 economics) — the mechanisms and their per-run telemetry
already exist in the product output. The certified evidence is packaged for external
review as the ICLR 2027 draft in `paper/` (deadlines: abstract 2026-09-18, paper
2026-09-25 AoE); its only unfilled numbers are the campaign's.

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
parallel fan-out · production certification of E7's iframe/shadow/action/SPA contracts ·
auth & profiles (**credentials never in trajectories** — redaction at
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
   [#54](https://github.com/kedarvartak/rote/issues/54) now has a frozen design for
   zero-LLM post-action evidence: exact value/URL effects are enforceable, while a click's
   generic DOM reaction remains shadow-only because unrelated mutation can false-pass and
   legitimate external effects can produce no DOM diff. Exact value/URL enforcement and
   shadow click evidence are implemented; T26 passes 9/9 fresh B1–B3 attempts with zero
   repairs and closes generic click enforcement as unsafe for P1. The final verifier still
   decides task success; future click gates require action-specific authoritative events.
2. **Small-model hosting** — Fara-class models are self-hostable (7B). Bundled local
   inference or API? Affects adoption friction vs the cost story. Decide in P2 with data.
3. **Matching threshold policy** — how conservative should τ be at launch? Lean:
   conservative (prefer misses) + per-playbook learned thresholds. **v1 (#157) ships
   τ = 0.8 token-Jaccard on the value-slotted task text with a 0.05 ambiguity margin;**
   per-playbook thresholds wait for T0/T4 data from the learning-curve stream.
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
