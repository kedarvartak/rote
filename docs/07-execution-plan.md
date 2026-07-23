# 07 — Execution Plan

> The work breakdown. [05](05-roadmap.md) owns strategy, phases, and gates; this doc owns
> **tasks**: what gets done, in what order, blocked by what, and how we know each one is
> done. If the two disagree, 05 wins and both get fixed in the same PR.
>
> Snapshot date **2026-07-17**. Owner: Kedar. Update cadence: every merged PR that
> completes a task flips its status here; a weekly pass re-checks the sequence table.
>
> **Board:** every task below is mirrored on the GitHub Project
> ([kedarvartak/projects/1](https://github.com/users/kedarvartak/projects/1)) with
> Epic / Week / State / Estimate fields; #50 #51 #52 #54 are on it as real issues. The
> board tracks day-to-day status; this doc stays the source of truth for scope,
> acceptance criteria, and sequencing — same precedence rule as with 05.

## How to read this doc

- **Task IDs** are `E<epic>.<n>` and are stable — refer to them in PRs and issues.
- **Estimates** are ideal engineer-days for one builder pairing with an agent. They are
  planning inputs, not promises ([05](05-roadmap.md): *gates are promises*).
- **Status vocabulary:** `done` · `in progress` · `ready` (unblocked, not started) ·
  `blocked (by)` · `decision` (needs a recorded choice before work starts).
- **Acceptance** is the exit test. A task without a checkable exit test is not a task;
  it is a wish.
- Definition of done for the phase = the two gates in [05 §Exit gate](05-roadmap.md)
  published, plus the launch checklist there fully checked.

## Where we are (inputs to this plan)

Authoritative build status: [02 §Status](02-architecture.md). The short version that
drives sequencing:

| Fact | Consequence for the plan |
|---|---|
| Eviction/diff built and G1-measured; cache layout minimally qualified; compaction not built | tier 0 clears G1 while cost/latency economics and G2 remain |
| B1–B3 render ~537 chars; the selected WordPress page renders 89,114 chars (~22,279 approximate tok) identically across 15 fresh sessions ([T2](testing/T2-measurement-page-selection.md)) | The real-page prerequisite is now met; E1.2 can fix the curve protocol and E1.4 can collect provider-reported sizes |
| #57 done: provider-normalized cache accounting, property-tested | caching work is unblocked and cannot fake a win |
| #49/#50 fixed: B2 11/11 | the matrix measures efficiency, not our bug |
| #50/#51/#52 done; open: [#54](https://github.com/kedarvartak/rote/issues/54) (diff-derived postconditions) | Planner slips no longer poison success parity; live expects are honestly optional and final verification remains mandatory |
| `@rote/cli` private at 0.0.0; README now carries G1; no demo | packaging and G2 still block launch |
| B4–B6 benchmark tasks specified, not built | a G2 scope decision is required (E4.1) |

## P1 — the epics

Six epics. E1 ran first under **measure before building** and now passes G1. The remaining
sequence must preserve that evidence while addressing G2 and launch packaging, not tune
the frozen curve after seeing it.

```
E1 curve (G1)  ──►  E3 cache layout  ──►  E4 level (G2)  ──►  E5 launch
     ▲                                          ▲
E2 robustness (#51/#52) ────────────────────────┘         E6 hygiene (parallel)
```

### E1 — The curve (gate G1). ~6–7 days

The headline instrument: cumulative input tokens vs. step count, Rote vs. Browser Use,
on a real page, at success parity, on the **provider's own** cache accounting.

| ID | Task | Est | Depends on | Acceptance | Status |
|---|---|---|---|---|---|
| E1.1 | **Choose the measurement page.** Candidates: a self-hosted open-source portal (deterministic, no ToS risk) vs. a public site. Criteria: distilled observation ≥5K tokens; stable across ≥15 runs; a scriptable 10–25-step task with a ground-truth verify. Record the decision and why in `docs/testing/`. | 1 | — | [T2](testing/T2-measurement-page-selection.md): digest-pinned WordPress, 22,279 approximate tok, zero range across 15 sessions; locally seeded and database-verified | done |
| E1.2 | **Define the curve protocol.** Task spec at n≈5/10/15/20/25 steps; per-step provider-reported usage (all three #57 buckets); JSONL schema with units; fixed seeds where applicable. | 1 | E1.1 | [`scripts/bench/curve/protocol.json`](../scripts/bench/curve/protocol.json) v3 fixes OpenAI `gpt-4.1-mini`, enumerates every long-cell target, and retains v2 plus inaccessible Anthropic v1 as archives; `curve-dry-run` emits and re-parses 77 valid non-evidentiary rows | done |
| E1.3 | **Browser Use per-step usage capture.** Extend the existing runner to record usage per step, same pinned model, same task file (fairness rules in [03](03-benchmark.md)). Known risk: BU may not surface per-step usage — fallback is wrapping the provider client. | 2 | E1.2 | strict receipt capture/normalizer built; a real OpenAI WP-N07 probe emitted and verified all 7 calls without being presented as frozen-protocol evidence | done |
| E1.4 | **Rote run of the same protocol.** This is the first live sighting of A4 and provider-reported real-page sizes. | 0.5 | E1.2, E1.9 | [T10](testing/T10-g1-cumulative-token-curve.md) audits 15 complete matched v8 repetitions: 75/75 verified successes per harness | done |
| E1.5 | **Draw and publish.** The graph (cumulative tokens vs. steps, both harnesses), method note, raw JSONL downloadable. | 1 | E1.3, E1.4 | README embeds the generated SVG and links method, raw receipts, normalized JSONL, and summary | done |
| E1.6 | **Set the G1 threshold** from the first honest run, in public — [05](05-roadmap.md) leaves it deliberately unset until now. Update 05 in the same PR. | 0.5 | E1.5 | [05](05-roadmap.md) sets a 30% lower-confidence-bound slope floor from the first 37.2% result, before optimization | done |
| E1.7 | **Findings record:** provider-reported prompt/cache buckets, whether A4 fired, and the inputs E3 needs. | 0.5 | E1.4 | T10 publishes all certification buckets; A4 emits 849 diffs and both harnesses' cache reads remain explicit | done |
| E1.8 | **Prove A4 on a real page.** Measure diff render sizes against their preceding grounded bases across the E1 protocol. | 1 | E1.4 | T10 reports 849 diffs, 24-character median, and 99.6% median reduction vs. preceding grounded bootstrap | done |
| E1.9 | **#67: bootstrap an oversized first observation safely.** The 40K-character page has no previous snapshot, so full misses the 4K budget and diff is impossible. Preserve a usable grounded base without configuring A4 away. | 1.5 | E1.2 | deterministic 10K-token test passes: explicit metered bootstrap is actionable, next small change is a diff; above the 100K-character cap fails before planning | done |

### E2 — Robustness at the planner boundary. ~3–4 days (+ stretch)

Recoverable model slips must not become recorded failures; they land on success parity
and poison both gates.

| ID | Task | Est | Depends on | Acceptance | Status |
|---|---|---|---|---|---|
| E2.1 | **#51: malformed planner completion.** One re-prompt carrying the parse error, budgeted like repair; typed error when exhausted; fallback stays clean (invariant 2). | 1.5 | — | invariant test: a malformed-then-valid completion sequence completes the run; initial usage tagged `planner`, corrective usage tagged `repair` | done |
| E2.2 | **#52: malformed optional `stableId`.** Treat as omitted with a logged classification instead of fatal. | 1 | — | test: junk `stableId` on an otherwise-valid action does not end the run | done |
| E2.3 | **#50 close-out.** Post-#49 live evidence shows tautological expects gone; close with links, or narrow the issue to what remains. | 0.5 | — | T1 records omission on every B1–B3 action and B2 11/11; docs credit final verification rather than optional live expects | done |
| E2.4 | **#54: postconditions from the observation diff** (stretch — may move to P2). Spec first: which diff facts are assertable without prediction. No model call. | 3–5 | E1.7 | spec reviewed before code; property tests over diff→expect derivation | decision |

### E3 — B3 cache layout, for real. ~4–5 days

The mechanism [02](02-architecture.md) admits does not exist. Only meaningful on the E1
page — our fixtures are below every provider's minimum cacheable prefix.

| ID | Task | Est | Depends on | Acceptance | Status |
|---|---|---|---|---|---|
| E3.1 | **Preflight from E1.7 data:** confirm real-page prompts clear the model-dependent minimums (4096 Opus 4.8-class / 2048 Fable 5, Sonnet 4.6 / 1024 older Sonnets; OpenAI 1024). If not, stop and say so — do not ship a lever that cannot fire. | 0.5 | E1.7 | reproducible T3 report: 26/86 calls eligible, 2 hits (7.7% of eligible), 39,552 cache-read tokens; proceed to layout work without claiming qualification | done — go |
| E3.2 | **OpenAI cache-layout qualification.** Automatic caching starts above 1024 tokens; arrange the immutable prefix so repeated real-page calls actually hit (measured via #57 buckets, cf. the 4027/4024 provider probe). | 2 | E3.1 | [T4](testing/T4-openai-cache-layout.md): history precedes page churn; 2/2 verified WP-N15 runs report a 1,024-token incremental cache read without padding or hiding logical input | done — mechanism only |
| E3.3 | **Optional Anthropic qualification.** When a key is available, add explicit 5-minute `cache_control` breakpoints and verify the same layout; this is portability evidence, not a P1 blocker. | 0.5 | E3.2 | optional provider probe or explicit defer note | optional |
| E3.4 | **Layout immutability tests.** Probes that plant a timestamp/run-id above the stable line and assert the build fails — the discipline is the moat ([04](04-competition.md)). | 1 | E3.2 | tests in the sacred suite; volatile-above-the-line fails | ready |
| E3.5 | **Measure and report.** Hit rate and $ delta on the E1 protocol, priced per bucket (reads ~0.1×). Re-draw the curve with caching on. | 1 | E3.2, E3.4 | before/after curve published; cache-adjusted per [03](03-benchmark.md) | blocked |

### E4 — The level (gate G2). ~4–6 days, mostly run-babysitting

| ID | Task | Est | Depends on | Acceptance | Status |
|---|---|---|---|---|---|
| E4.1 | **G2 scope decision:** launch on B1–B3 only, or build B5 (drift) first? [04](04-competition.md) argues B5/T5 is the wedge instrument; it is also unbuilt. Recorded decision with the trade-off. | 0.5 | — | decision in this doc + 05 | decision |
| E4.2 | **B5 drift fixture** (if chosen): B2 with scripted DOM mutations between runs; grades the repair path and the silent-failure rate. | 2 | E4.1 | fixture + mutation script deterministic in CI | blocked |
| E4.3 | **Certification runs:** ≥15/harness/task, seeded bootstrap (10k resamples), lower bound vs. floor — machinery exists, has never been run to completion. | 1–2 | E2.1, E2.2 | `launch-gate` passes or fails loudly; raw JSONL kept | blocked |
| E4.4 | **Symmetric verification audit:** confirm competitor runs are graded by our own rule (success = concluded **and** live-page verification text) on real output, not just in code review. | 1 | E4.3 | audit note in `docs/testing/` | blocked |
| E4.5 | **G2 report:** tokens per source, latency avg/p50/p95 ms, $ per task from the dated price table; `price unavailable` never $0. | 0.5 | E4.3 | report generated from raw data by one command | blocked |

### E5 — Launch package. ~4–5 days

| ID | Task | Est | Depends on | Acceptance | Status |
|---|---|---|---|---|---|
| E5.1 | **Publish `@rote/cli`** (0.1.0): npm name check, `bin` wiring, quickstart. | 1.5 | E4 green | `npx rote run <task>` works on a clean machine with only an API key | blocked |
| E5.2 | **README with the number:** curve graph, G1/G2 results, units, method links, reproduction one-liner. | 0.5 | E1.5, E4.5 | every claim carries a number + link | blocked |
| E5.3 | **Demo:** terminal recording of cold run → warm replay → drift repair on the fixture suite. | 1 | E5.1 | linked from README | blocked |
| E5.4 | **Known-limitations doc:** no distiller (tier 1 is V2), no routing/speculation, eviction trades recall for cost, weak-fit list from [01](01-problem.md). | 0.5 | — | honest, linked from README | ready |
| E5.5 | **Licence check** on competitor dependencies (dependencies, not forks). | 0.5 | — | recorded | ready |
| E5.6 | **Launch checklist walk** ([05](05-roadmap.md)) + ship. | 1 | all E5 | every box checked or consciously waived in public | blocked |

### E6 — Hygiene, in parallel. ~3 days

| ID | Task | Est | Depends on | Acceptance | Status |
|---|---|---|---|---|---|
| E6.1 | **Heavyweight deterministic fixture** (~10–40K tok distilled): the first environment where A4 fires in CI and the oversized-base contract is covered. | 2 | — | #67 adds an 800-node (~10K-token) fixture asserting grounded bootstrap → ordinary-budget `diff` | done |
| E6.2 | **Efficiency-regression budgets in CI** (G2 in [06](06-optimizations.md)) — deliberately post-launch; recorded here so it is not forgotten. | 1 | E5.6 | per-fixture token budgets enforced | deferred (P2) |
| E6.4 | **Eviction recall-trade stress test.** The policy keeps what the agent *did*, not what it *saw*; a task needing an evicted page must fail **cleanly**, not silently wrong ([02 §The policy](02-architecture.md)). Build a compare-across-pages fixture task and assert the failure is clean and classified. | 1 | E6.1 | test in the invariant suite; the limit documented in [01 §fit](01-problem.md) gains a measured example | ready |
| E6.3 | **Issue triage cadence:** weekly pass over open issues; anything touching success parity is P1-blocking by default. | — | — | this doc's snapshot stays current | ongoing |

### Sequence (target: 2026-Q3 launch, per 05)

Assumes one builder + agent, ~5 effective days/week. Buffer is real; live-provider work
slips.

| Week | Focus | Exit |
|---|---|---|
| W1 | E1.1–E1.4 · E2.1–E2.3 in the gaps | both harnesses emit per-step JSONL on the real page |
| W2 | E1.5–E1.7 · E6.1 | **the curve exists**; G1 threshold set in public |
| W3 | E3 (all) | caching measured, curve re-drawn with it on |
| W4 | E4 (incl. the E4.1 decision) | G2 certified or failed loudly |
| W5 | E5.1–E5.5 | quickstart + README + demo ready |
| W6 | buffer · E5.6 | **launch, or a published reason why not** |

## P2 — entry criteria and shape (~8–10 weeks, detail deferred)

Do not start any of these before E5.6 ships or P1 is explicitly killed — the launch
cadence argument in [05](05-roadmap.md) is binding. Order within P2:

1. **B4 compaction** — finishes tier 0; the only lever that makes the curve linear.
   Cache-economics-scheduled (it fights B3 by construction). Entry: E3.5 data on real
   cache hit rates, so the schedule is derived, not guessed.
2. **Distiller v1** — trajectory → playbook (causal pruning, parameterization, assertion
   synthesis). Gate: distilled playbooks replay the fixture suite with zero human edits.
   This is tier-1 catch-up; the differentiator remains the verification contract.
3. **Predictor kill-gate first**: ≥70% warm next-action accuracy offline on recorded
   runs, before any speculation systems work. Costs no systems work; can kill P3 early.
4. **Site memory** (tier 2, advisory-only) and **model routing** — in that order, each
   behind the measured gates in [03](03-benchmark.md) (T2 ≥30%; ≥50% warm steps off the
   frontier model at parity).

P3 (speculation), P4 (fleet), P5 (platform): unchanged from [05](05-roadmap.md); no task
breakdown until P2 exits.

## RAID

**Risks**

| Risk | Impact | Mitigation |
|---|---|---|
| Browser Use does not expose per-step usage | E1.3 slips | wrap the provider client; worst case, count at the API proxy — record which was used |
| Real page too nondeterministic for ≥15-run variance | G2 uncertifiable | prefer self-hosted portal in E1.1; seed data per run |
| Real-page prompts still under cache minimums (the fixture problem recurring at scale) | E3 dead on arrival | E3.1 is an explicit go/no-go; if no-go, say so publicly — that is itself a finding |
| The curve shows no material gap | G1 fails, thesis wrong | that is the point of measuring first; costs one benchmark ([05](05-roadmap.md)) |
| npm name `rote` taken | quickstart friction | check early in E5.1; fallback scope name documented |
| Solo-builder bus factor | schedule | this doc + docs 01–06 are the handoff |

**Assumptions:** 1–3 builders; OSS-first; pinned models stay available through E4;
provider pricing table refreshed at E4.5.

**Issues (open, tracked):** #54 (stretch). **Done:** #50 · #51 · #52.

**Dependencies:** provider usage APIs (#57 contract) · Browser Use as a dependency,
never a fork · CDP/Chrome stability on the measurement page.

## Operating rhythm

- **Per PR:** name the task ID it advances; flip its status here in the same PR when it
  completes (a stale plan is a bug, same rule as the design docs).
- **Weekly:** re-check the sequence table against reality; move slipped work visibly —
  never silently.
- **Per gate:** G1 and G2 results are published with raw data whether they pass or fail.
  **No number, no launch** — and a failed number is still a number.

Next: [06 — Optimizations](06-optimizations.md) for what each lever is worth.
