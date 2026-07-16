# 01 — The Problem

> **Browser agents have no memory management. They forget at three timescales, and pay
> again at every one.**

Not "no memory" — every harness has a context window and most have some cache. What none
of them has is a **manager**: a component that owns what is remembered, what is evicted,
what is written down, and what may be trusted on the way back in. The context window is
treated as a garbage dump. Append, and hope.

## The three amnesias

The same disease at three scales. The agent forgets, so it re-derives, so it pays again.

| Tier | Scope | What it forgets | The bill |
|---|---|---|---|
| **0 — Working** | within one run | what it already sent this run | **O(n²) in task length** |
| **1 — Episodic** | across runs of one task | the procedure that worked yesterday | run #50 costs what run #1 cost |
| **2 — Semantic** | across tasks on one site | how this site behaves at all | every task re-learns the portal |

Tier 1 is the one the field talks about. Tier 0 is measurable today, unowned by anyone,
and the reason V1 exists ([05](05-roadmap.md)).

## Tier 0: the quadratic nobody names

Agent loops re-send their transcript every step. A run of *n* steps sends `1 + 2 + … + n`
prompt-units: **cost is O(n²) in task length.**

Every optimization the field competes on — DOM serializers, element filtering,
vision-versus-a11y, prompt splitting — shrinks the *per-step* prompt. Those lower the
constant. **Nobody has touched the exponent**, because doing so means owning prompt layout
as an architectural rule rather than appending messages wherever it is convenient.

Measured on our own live runs (2026-07-16, `gpt-5.6-luna`, frozen fixtures):

```
B2 (10 steps):  637 → 677 → 716 → 759 → 800 → 839 → 876 → 917 → 953 → 881   (+38%)
B1  (5 steps):  418 → 452 → 489 → 519 → 588                                 (+41%)
```

**21% of B2's input bill is re-reading text we already sent** — on a 10-step task against
a page that distills to 10 nodes. Both figures are lower bounds; these fixtures are toys.

Browsers are the pathological case, and the pathology is also the exploit:

| Property of browser observations | Consequence |
|---|---|
| **Enormous** — a real page is 5–40K tokens of DOM | the per-step constant is huge |
| **Redundant** — ~95% is byte-identical after one click | nearly all of it is re-sent waste |
| **Sequentially correlated** — step *n+1* differs by a few nodes | the redundancy is *computable* as a diff |

A general agent with 200-token observations has a quadratic nobody notices. A browser agent
with 20K-token observations has one that dominates the bill by step 10.

## Tier 1: re-derivation

Run 1: 40 tool calls discovering the login flow, the nav structure, which button downloads
the report. Succeeds. Run 2, next day, fresh context: **the same 40 calls, the same dead
ends, the same bill.**

The harness threw away the most valuable thing it produced — the *procedure*. This is
amnesia not about facts but about **skills**.

## Where the money goes

```
per step:  cost ≈ observation tokens + history tokens + reasoning/output tokens
           time ≈ model think + action + page settle + observation build
```

Input tokens dominate agentic spend (~85%), and **observations dominate input**. Raw DOM
can exceed 100 lines per logical form field; enterprise pages reach 40–500K tokens raw.
That observation is rebuilt and re-sent every step, of every run, forever.

The first two terms are memory failures. Only the third is the model actually thinking.

## The three token-spending paths

| Path | What it is | Who owns it |
|---|---|---|
| **Read** | Compress what goes *into* context | Compression proxies, provider-side context editing — crowded |
| **Write** | Cross-session *semantic* memory ("the user prefers X") | Mem0, Zep, Letta — crowded |
| **Reuse** | Replaying *how* a task was solved, so it is never re-derived | Contested — see below |

Read-path tools make every token cheaper. Reuse-path tools make most tokens **not exist**
— a categorically bigger lever. Compressing a 40-call exploration by 90% still costs 40
round-trips, 40 chances to wander, and 40 steps of latency. Not doing the exploration
costs ~0.

Why the adjacent tools don't close it:

- **Semantic memory** stores facts and injects them. The agent still runs the full control
  loop every step. **Recall is not replay.**
- **Compression** sits at the token-stream boundary, where *steps do not exist*. It can
  shrink a step; it cannot decline to run one.
- **Workflow engines** replay beautifully — but a human authors the workflow. The whole
  point of an agent is that nobody authored the procedure.
- **Prompt/skill files** are the manual, prose-shaped version. They prove the demand; they
  are text the model re-interprets every run, not executable steps.

**Reuse is no longer a gap.** Skyvern ships agent-run → generated code → zero-LLM replay →
auto-fallback, with progressive branch coverage. Stagehand caches resolved selectors behind
a page-similarity check. We are late to tier 1, not early ([04](04-competition.md)).

**Tier 0 is the gap.** No shipping harness manages working memory, and it is the tier where
the exponent lives.

## The precondition: memory you can trust

Memory that might be wrong is worse than no memory. A cheap wrong answer costs more than an
expensive right one, because you find out three weeks later.

This is not a separate feature; it is what makes the other two tiers *usable*. Skyvern's
fallback fires on runtime errors, so a replay that throws nothing is assumed correct —
which is how a cached click "succeeded" against an element that no longer existed
(#SKY-7577). Reuse without verification is a machine for producing confident, silent,
repeated wrongness at volume.

Hence invariant 1. **Every tier of memory is assertion-gated on the way back in.**

## The name

**Memoization applied to agent trajectories**: cache the result of an expensive computation
(exploration), keyed by task class and environment fingerprint, with invalidation by
assertion and scoped repair rather than TTL. Hence **Rote**.

The two genuinely hard sub-problems:

- **Generalization** — which of the 40 recorded calls were essential rather than
  incidental, and which literals are actually *parameters* of the task class?
- **Self-healing** — the selector moved; repair the one broken step instead of falling back
  to full re-exploration.

## Where Rote fits — and where it doesn't

Being honest about the fit is load-bearing; the benchmark reports the losses too
([03](03-benchmark.md)).

**Strong fit**

- **Repeated portal work** — the same login → navigate → extract with different parameters,
  hundreds of times a day. Deterministic control flow, high repetition.
- **High-volume operational agents** — where the bill *is* the product.
- **Expensive observation loops** — enterprise DOMs where the page dwarfs the reasoning.
- **Long tasks** — tier 0's quadratic is worst exactly where tasks run longest, and tier 0
  pays even on a task that never recurs.

**Weak fit — say it out loud**

- **One-off sites.** Tier 1 memoization pays nothing on a task that never recurs; matcher
  overhead is pure cost. Break-even ≈ 2 runs. (Tier 0 still pays.)
- **Open-ended browsing.** "Research this topic" has no procedure to reuse.
- **Sites that change meaning, not layout.** Repair handles a renamed selector. It cannot
  handle a changed business rule, and must not pretend to.
- **Creative work.** Out of scope by construction — the matcher must reliably *miss* these
  rather than confidently replay something wrong.
- **Tasks needing recall of earlier pages.** Our working-memory policy keeps what the agent
  *did*, not what it *saw* ([02](02-architecture.md) §Tier 0). "Compare prices across three
  products" needs observations we evict. A real limit, not a footnote.

## Why browser agents are the right wedge

Browser workflows are simultaneously the **worst case for forgetting** (DOM exploration is
the most token-expensive perception there is, and its observations are the largest thing
re-sent) and the **best case for memory** (portals and forms are relentlessly repetitive).
Drift is testable — mutate the DOM, watch the repair path. And the economics are legible: a
token is a token, and anyone can check the arithmetic.

Next: [02 — Architecture](02-architecture.md)
