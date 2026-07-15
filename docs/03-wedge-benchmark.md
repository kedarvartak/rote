# 03 — Wedge Benchmark: "Run It Twice"

## Purpose

Validate the core thesis with one violent, undeniable number before building anything
platform-shaped:

> **The same agent, given the same task class twice, should not pay twice.**

If the run-1 vs run-2 delta isn't dramatic, the thesis is wrong and we stop. If it is,
this benchmark *is* the pitch deck.

## Vertical choice: browser automation first

Chosen wedge: **browser-automation tasks**, with coding-agent CI/build tasks as the second
suite. Rationale:

- Browser workflows are the worst case for re-derivation (DOM exploration is hugely
  token-expensive: accessibility trees, screenshots, retries) and the best case for
  memoization (portals and forms are highly repetitive).
- Drift is naturally testable — mutate the DOM and watch the repair ladder work.
- We already operate a browser-automation MCP stack (navigate/fill/extract/assert tools),
  so instrumentation cost is near zero and the "explore once, replay deterministically"
  pattern is already proven in-house.

## Task suite

Six tasks per vertical, chosen to span the memoization difficulty spectrum:

| # | Task class | Params | Why included |
|---|-----------|--------|--------------|
| B1 | Log into portal, download latest report | none | pure-deterministic best case |
| B2 | Fill multi-page vendor/registration form | 8 field values | slot binding under param variation |
| B3 | Search catalog, extract top-N results to JSON | query, N | parameterized extraction |
| B4 | Triage flow: read item, categorize, route | item id | includes a judgment gate |
| B5 | B2 again, but the form DOM is mutated between runs | 8 fields | **drift / repair test** |
| B6 | A task superficially similar to B2 but genuinely different | — | **false-match test (must miss)** |
| C1 | Clone repo, discover + run test suite | repo | coding-agent cold-start classic |
| C2 | Reproduce a CI failure locally | build id | high exploration cost |
| C3 | Release checklist (bump, changelog, tag, push dry-run) | version | multi-step procedure |

## Protocol

For each task class, three phases — every phase fully instrumented:

1. **Cold** — plain agent, Rote recording. Repeat ×3 for variance.
2. **Warm** — same task class, new parameter values, Rote replaying. ×5.
3. **Drift** — perturb the environment (rename a selector, move a config file, bump a CLI
   flag), then run again. ×3. Also run the **baseline agent** on the drifted env — drift
   costs baseline agents tokens too; the comparison must be fair.

Baseline control: the plain agent runs *every* phase without Rote. The headline claim is
Rote-warm vs baseline-run-N, not vs baseline-run-1 (agents get mildly cheaper on rerun via
prompt caching alone — we must beat that honestly, and report cache-adjusted numbers).

## Grading a competitor (symmetric verification)

We are not trying to be better *by comparison*; we are trying to be better *by function*.
A benchmark only tells us whether the function is better if it is built to be indifferent
to who wins, so a competitor is graded by the exact rule Rote applies to itself:

> A run counts as **success** only if the agent concluded it was done **and** the final
> live page shows the same verification text Rote's own run must see.

Taking a competitor's self-report ("the agent says it finished") while Rote must prove it
would hold the two to different standards, and the success-parity metric below — the only
thing preventing Rote from "winning" by being cheap and wrong — would stop meaning
anything. An agent that never concluded (e.g. hit its step ceiling) is **abandoned**;
Rote's own agent loop yields the same in that situation.

**A missing measurement is never scored.** Non-success outcomes stay in the success-rate
denominator, so a run we could not verify because *our* probe broke would silently cost
the competitor success rate; unreadable token usage recorded as `0` would fabricate a Rote
win outright. Both must fail loudly on the first run instead. This is invariant 1 ("never
silently wrong") applied to the benchmark: a number we cannot substantiate is not a number.

## Metrics

| Metric | Definition | Kill / pass thresholds |
|---|---|---|
| **Token reduction** | warm tokens ÷ baseline-rerun tokens | pass ≥ 80% reduction; kill < 50% |
| **Latency reduction** | wall-clock warm ÷ baseline | pass ≥ 5×; kill < 2× |
| **Tool-call reduction** | calls warm ÷ baseline | expect 5–10× |
| **Task success parity** | warm success rate vs baseline | **must be ≥ baseline — non-negotiable** |
| **Output equivalence** | semantic-equivalence check of final artifacts | ≥ 95% |
| **Drift recovery rate** | drifted runs completing via repair (no full fallback) | pass ≥ 70% |
| **Repair cost ratio** | repair-run tokens ÷ cold-run tokens | pass ≤ 25% |
| **False-match rate** | B6-style tasks incorrectly replayed | **target 0; any silent wrong output kills the design** |
| **Match overhead** | tokens burned by matcher on true misses | ≤ 2% of a cold run |

## Instrumentation

- Token accounting from provider usage fields per call, tagged
  `{run_id, phase, task, source: planner|matcher|slot|repair|verify}` — so the report can
  show not just *how much* was saved but *which component* spent what.
- Every run emits a JSONL trajectory (the Recorder's native format) → the benchmark
  harness and the product share one data model from day one.
- Publish raw JSONL + analysis notebook. Credibility in this space comes from
  reproducibility — a concrete, checkable number beats a vague percentage claim every time.

## Honest-loss scenarios (report these, don't hide them)

- **One-shot tasks** — memoization pays nothing on tasks that never recur; matcher overhead
  is pure cost. Report the break-even recurrence count (expected: ~2).
- **High-drift surfaces** — if repair fires on most runs, playbooks thrash. Report the
  drift rate above which Rote stops paying.
- **Genuinely creative tasks** — writing, design, novel debugging: out of scope by
  construction; the matcher must reliably *miss* these (B6 generalizes).

## Demo script (the 90-second version)

1. Terminal left: baseline agent does B2 — viewer watches 40 calls crawl by, token meter
   spinning. ~90s.
2. Terminal right: Rote-warm run of B2 with different form values — 6 calls, done in ~8s.
3. Mutate the DOM live. Run again — step 4 fails, scoped repair patches it, run completes.
   Token meter shows ~15% of cold cost.
4. Show the diff: `playbook v1 → v2`, one step changed, human-readable.

Next: [04 — Market](04-market.md)
