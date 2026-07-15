# 03 — Benchmark: How We Measure

> If the number isn't real, nothing else here matters. **No number, no launch.**

## The claim under test

> **The same agent, given the same task class twice, should not pay twice** — and
> eventually: *tokens per task should fall with accumulated experience on a site.*

The first is V1's claim. The second is V2's, and needs the learning plane
([02](02-architecture.md)) to exist first.

## Task suite

Six browser tasks spanning the memoization difficulty spectrum. B1–B3 are built as frozen
fixtures (`fixtures/sites/`); B4–B6 are specified, not yet built.

| # | Task | Params | Why it's in the suite |
|---|---|---|---|
| **B1** | Log in, download latest report | — | pure-deterministic best case |
| **B2** | Fill multi-page vendor form | 8 fields | slot binding under param variation |
| **B3** | Search catalog, extract top-N | query, N | parameterized extraction |
| B4 | Triage: read, categorize, route | item id | includes a judgment gate |
| B5 | B2 with the DOM mutated between runs | 8 fields | **drift / repair test** |
| B6 | Superficially like B2, genuinely different | — | **false-match test (must miss)** |

B6 is the most important row. A benchmark that only rewards replaying is a benchmark you
can win by replaying wrongly.

## Metrics

| Metric | Definition | Pass / kill |
|---|---|---|
| **Token reduction** | warm ÷ baseline-rerun, cache-adjusted | pass ≥80%; kill <50% |
| **Success parity** | success rate vs baseline | **must be ≥ baseline — non-negotiable** |
| **Latency reduction** | wall-clock warm ÷ baseline | pass ≥5×; kill <2× |
| **False-match rate** | B6-style tasks incorrectly replayed | **target 0; any silent wrong output kills the design** |
| **Drift recovery** | drifted runs completing via repair, no full fallback | pass ≥70% |
| **Repair cost ratio** | repair-run ÷ cold-run tokens | pass ≤25% |
| **Match overhead** | tokens burned by the matcher on true misses | ≤2% of a cold run |
| **Observation-token share** | observation tokens ÷ total | the thing perception attacks; report before/after |

All token counts are per-`source`-tagged (invariant 5), so the report shows *which
component spent what* — including what advising/matching costs. "≥30% reduction" must be
net of its own overhead.

## Fairness rules (they bind us, not just competitors)

We are not trying to win a comparison. We are trying to be efficient, and the comparison
is only an instrument — **it informs us only if it is built to be indifferent to who wins.**

- **Same task specs, same model, same pages.** Both harnesses read one task file
  (`scripts/bench/headhead/tasks.json`); a test asserts the Rote plan agrees with it. The
  model is pinned there, not left to a default.
- **Cache-adjusted counts.** Agents get cheaper on rerun via prompt caching alone. We
  must beat that honestly. The headline is Rote-warm vs baseline-**run-N**, never run-1.
- **Competitors are dependencies, never forks.** A fork we control is a fork we could
  tune. Their config is best-effort and documented.
- **Grade the competitor by our own rule** (below).
- **Publish adapters, configs, and raw JSONL.** Credibility here comes from
  reproducibility; a concrete checkable number beats a vague percentage every time.

### Symmetric verification

> A run counts as **success** only if the agent concluded it was done **and** the final
> live page shows the same verification text our own run must see.

Taking a competitor's self-report while Rote must prove it would hold the two to
different standards, and success parity — the only thing stopping Rote from "winning" by
being cheap and wrong — would stop meaning anything. An agent that never concluded is
**abandoned**; our own loop yields the same in that situation.

**A missing measurement is never scored.** Non-success outcomes stay in the success-rate
denominator, so a run we couldn't verify because *our* probe broke would silently cost
the competitor success rate; unreadable token usage recorded as `0` would fabricate a win
outright. Both fail loudly instead. This is invariant 1 applied to the benchmark: **a
number we cannot substantiate is not a number.**

## Variance: how a win gets certified

One agent run is noisy — a single retry moves the token count — so the gate trusts
neither one run nor a mean. Each task runs **≥15 times per harness**, and the reduction is
reported as a **seeded-bootstrap confidence range** (10,000 resamples, fixed seed, so the
output is byte-stable). The gate passes only when the range's **lower bound** clears the
floor.

The publishable claim is that lower bound, not the mean: *"38% fewer tokens (95% CI:
31–44%)"*. Fewer than 15 successful runs is not a certifiable win, by design.

> Superseded: an earlier draft asked for "×5 runs". At n=5 no test is both rigorous and
> tolerant of overlap (a Mann-Whitney U at n=5 needs near-total separation), forcing a
> choice between a brittle gate and a meaningless one. More runs plus a conservative
> interval resolves it and yields a range we can publish.

## The G1 report

Tokens (per source), latency (avg/p50/p95 ms), and **$ per task** — priced from a dated,
overridable table with the source URL recorded. An unpriced model is reported as
`price unavailable`, **never $0**: a zero reads as "free" and quietly flatters whichever
harness lacks a price.

Tokens and dollars are not the same number. Output tokens bill several times input, so a
harness whose savings skew toward input saves less money than it saves tokens. Report both.

## Generalization (V2)

Once the learning plane exists, the headline artifact stops being a single warm-vs-cold
ratio and becomes a **learning curve**: tokens/task against task index over a realistic
stream. Rote's curve must fall; the baseline's stays flat.

Every task in the stream lands in one transfer cell:

| Condition | Example | Tier | Must happen |
|---|---|---|---|
| **T0 repeat** — same task, same site, new params | B2 with new values | 1 replay | ≥80% reduction at parity |
| **T1 sibling** — different task, shared prefix | B2 → "update bank details" | 2 + 3 | ≥50% of the shared prefix's cold cost |
| **T2 novel-on-known** — unrelated task, known site | B2 → "export vendor CSV" | 3 advisory | **≥30% reduction at parity — the generalization kill gate** |
| **T3 novel site** — never-seen site | new portal | none | overhead ≤2%; Rote must get out of the way |
| **T4 near-miss** — must NOT match | B6 generalized | matcher discipline | false-replay rate 0 |
| **T5 drift** — known site, mutated DOM | B5 | all | repair, or detect-and-downgrade; never silently follow a stale fact |

**Kill gates:** T2 <15% → advisory memory isn't worth its complexity; retreat to a replay
tool (tiers 1–2) and compete on verification. *Survivable, not a project kill.* Any T4
false replay, or any T5 stale fact producing a wrong answer → **design kill**. T3
overhead >2% → the site brief becomes opt-in.

Additional metrics: **break-even task count** (where cumulative Rote cost, including
distillation, drops below baseline — expected 2–4 tasks/site), **hint utility** (fraction
of brief facts the agent actually used — a 2K-token brief at 5% utility is overhead, not
memory), and **hint harm rate**. Report success parity **per condition** — an aggregate
hides a T2 regression behind T0 wins.

## Honest-loss scenarios — report these

- **One-shot tasks** — memoization pays nothing; matcher overhead is pure cost. Report
  the break-even recurrence count.
- **High-drift surfaces** — if repair fires on most runs, playbooks thrash. Report the
  drift rate above which Rote stops paying.
- **Creative tasks** — out of scope by construction; the matcher must reliably miss.

## Running it

Full runbook: [`scripts/bench/headhead/README.md`](../scripts/bench/headhead/README.md).

```bash
node scripts/bench/headhead/serve-fixtures.mjs 8080          # frozen pages
rote-bench run   scripts/bench/headhead/rote-plan.json --out bench-out/rote
python scripts/bench/headhead/browser-use/run_browser_use.py --out bench-out/browser-use
rote-bench competitor-records bench-out/browser-use/raw-runs.json --harness browser-use \
  --model <same model> --cache-adjusted <true|false> --out bench-out/browser-use.json
rote-bench records     bench-out/sources.json  --out bench-out/records.json
rote-bench launch-gate bench-out/records.json  --min-runs 15
```

Live-run findings are recorded in [`docs/testing/`](testing/). **As of
[T1](testing/T1-openai-dry-run.md), the matrix should not be run**: B2 fails 0/7 on a
design flaw ([#49](https://github.com/kedarvartak/rote/issues/49)), so the gate would
measure our bug rather than our efficiency.

Next: [04 — Competition](04-competition.md)
