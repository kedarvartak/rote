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
| Eviction built; diff built-but-inert; cache and compaction not built | tier 0 is half-built and **entirely unmeasured** |
| Fixtures render ~537 chars; A4 budget is 4000; cache minimums are 1024–4096 tok | **nothing tier-0 can be proven on our fixtures** — a real page is a prerequisite, not a nice-to-have |
| #57 done: provider-normalized cache accounting, property-tested | caching work is unblocked and cannot fake a win |
| #49/#50 fixed: B2 11/11 | the matrix measures efficiency, not our bug |
| #51 done; open: [#52](https://github.com/kedarvartak/rote/issues/52) (malformed optional stable ID), [#54](https://github.com/kedarvartak/rote/issues/54) (diff-derived postconditions), #50 (close-out) | #52 lands on success parity exactly the way #49 did — fix before certifying any number |
| `@rote/cli` private at 0.0.0; README has no number; no demo | the launch package is all unstarted |
| B4–B6 benchmark tasks specified, not built | a G2 scope decision is required (E4.1) |

## P1 — the epics

Six epics. E1 is deliberately first: **measure before building** — three of the four
tier-0 levers have never been exercised, and the first task is the curve, not the code.

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
| E1.1 | **Choose the measurement page.** Candidates: a self-hosted open-source portal (deterministic, no ToS risk) vs. a public site. Criteria: distilled observation ≥5K tokens; stable across ≥15 runs; a scriptable 10–25-step task with a ground-truth verify. Record the decision and why in `docs/testing/`. | 1 | — | decision recorded; page reachable and seeded locally | decision |
| E1.2 | **Define the curve protocol.** Task spec at n≈5/10/15/20/25 steps; per-step provider-reported usage (all three #57 buckets); JSONL schema with units; fixed seeds where applicable. | 1 | E1.1 | protocol doc committed; a dry run emits valid JSONL | ready |
| E1.3 | **Browser Use per-step usage capture.** Extend the existing runner to record usage per step, same pinned model, same task file (fairness rules in [03](03-benchmark.md)). Known risk: BU may not surface per-step usage — fallback is wrapping the provider client. | 2 | E1.2 | one BU run emits per-step JSONL from provider-reported usage | blocked (E1.2) |
| E1.4 | **Rote run of the same protocol.** No code changes expected; this is the first live sighting of A4 and real observation sizes. | 0.5 | E1.2 | Rote JSONL for the same task matrix | blocked (E1.2) |
| E1.5 | **Draw and publish.** The graph (cumulative tokens vs. steps, both harnesses), method note, raw JSONL downloadable. | 1 | E1.3, E1.4 | graph embedded in README with units and method link | blocked |
| E1.6 | **Set the G1 threshold** from the first honest run, in public — [05](05-roadmap.md) leaves it deliberately unset until now. Update 05 in the same PR. | 0.5 | E1.5 | 05 names a number and its provenance | blocked |
| E1.7 | **Findings record** (`docs/testing/T2-…`): observation sizes, whether A4 fired, prompt sizes vs. cache minimums — the inputs E3 needs. | 0.5 | E1.4 | T2 committed | blocked |
| E1.8 | **Prove A4 on a real page.** Diff observations have never fired; the −90%-on-the-constant claim is untested at any page size ([02 §What is unproven](02-architecture.md)). Measure diff-vs-full render sizes across the E1 protocol steps. | 1 | E1.4 | measured diff/full ratio published alongside the curve; A4's row in [06](06-optimizations.md) loses "never fired" | blocked |

### E2 — Robustness at the planner boundary. ~3–4 days (+ stretch)

Recoverable model slips must not become recorded failures; they land on success parity
and poison both gates.

| ID | Task | Est | Depends on | Acceptance | Status |
|---|---|---|---|---|---|
| E2.1 | **#51: malformed planner completion.** One re-prompt carrying the parse error, budgeted like repair; typed error when exhausted; fallback stays clean (invariant 2). | 1.5 | — | invariant test: a malformed-then-valid completion sequence completes the run; initial usage tagged `planner`, corrective usage tagged `repair` | done |
| E2.2 | **#52: malformed optional `stableId`.** Treat as omitted with a logged classification instead of fatal. | 1 | — | test: junk `stableId` on an otherwise-valid action does not end the run | ready |
| E2.3 | **#50 close-out.** Post-#49 live evidence shows tautological expects gone; close with links, or narrow the issue to what remains. | 0.5 | — | issue closed or re-scoped with evidence | ready |
| E2.4 | **#54: postconditions from the observation diff** (stretch — may move to P2). Spec first: which diff facts are assertable without prediction. No model call. | 3–5 | E1.7 | spec reviewed before code; property tests over diff→expect derivation | decision |

### E3 — B3 cache layout, for real. ~4–5 days

The mechanism [02](02-architecture.md) admits does not exist. Only meaningful on the E1
page — our fixtures are below every provider's minimum cacheable prefix.

| ID | Task | Est | Depends on | Acceptance | Status |
|---|---|---|---|---|---|
| E3.1 | **Preflight from E1.7 data:** confirm real-page prompts clear the model-dependent minimums (4096 Opus 4.8-class / 2048 Fable 5, Sonnet 4.6 / 1024 older Sonnets; OpenAI 1024). If not, stop and say so — do not ship a lever that cannot fire. | 0.5 | E1.7 | go/no-go recorded with prompt sizes | blocked |
| E3.2 | **Anthropic `cache_control` breakpoints** on the stable prefix and append-only history; 5-minute TTL only (the accounting refuses 1-hour writes by design — #57). | 2 | E3.1 | live probe shows `cache_read_tokens` > 0 on a warm step | blocked |
| E3.3 | **OpenAI qualification check.** Caching is automatic above 1024 — verify our layout actually hits (measured via #57 buckets, cf. the 4027/4024 probe). | 0.5 | E3.1 | warm-step `cache_read_tokens` ≈ prefix size | blocked |
| E3.4 | **Layout immutability tests.** Probes that plant a timestamp/run-id above the stable line and assert the build fails — the discipline is the moat ([04](04-competition.md)). | 1 | E3.2 | tests in the sacred suite; volatile-above-the-line fails | blocked |
| E3.5 | **Measure and report.** Hit rate and $ delta on the E1 protocol, priced per bucket (reads ~0.1×, 5-min writes 1.25×). Re-draw the curve with caching on. | 1 | E3.2–E3.4 | before/after curve published; cache-adjusted per [03](03-benchmark.md) | blocked |

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
| E6.1 | **Heavyweight deterministic fixture** (~10–40K tok distilled): the first environment where A4 fires in CI, and the budget's degrade ladder (full→diff→summary) gets covered at all. | 2 | — | a deterministic test asserts a `diff` render occurred | ready |
| E6.2 | **Efficiency-regression budgets in CI** (G2 in [06](06-optimizations.md)) — deliberately post-launch; recorded here so it is not forgotten. | 1 | E5.6 | per-fixture token budgets enforced | deferred (P2) |
| E6.4 | **Eviction recall-trade stress test.** The policy keeps what the agent *did*, not what it *saw*; a task needing an evicted page must fail **cleanly**, not silently wrong ([02 §The policy](02-architecture.md)). Build a compare-across-pages fixture task and assert the failure is clean and classified. | 1 | E6.1 | test in the invariant suite; the limit documented in [01 §fit](01-problem.md) gains a measured example | blocked |
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

**Issues (open, tracked):** #50 close-out · #52 · #54 (stretch). **Done:** #51.

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
