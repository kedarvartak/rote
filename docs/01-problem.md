# 01 — The Problem

> **Browser agents re-derive everything, every run, and pay for it in tokens.**

## Where the money goes

Per step:

```
cost ≈ observation tokens + history tokens + reasoning/output tokens
time ≈ model think + action + page settle + observation build
```

Input tokens dominate agentic spend (~85%), and **observations dominate input**. Raw
DOM can exceed 100 lines per logical form field; enterprise pages reach 40–500K tokens
raw. That observation is rebuilt and re-sent every step, of every run, forever.

## What re-derivation looks like

Run 1: 40 tool calls discovering the login flow, the nav structure, which button
downloads the report. Succeeds. Run 2, next day, fresh context: **the same 40 calls,
the same dead ends, the same bill.**

The harness threw away the most valuable thing it produced — the *procedure*. Agents
have episodic amnesia not about facts (semantic memory solves that) but about **skills**.

## The three token-spending paths

| Path | What it is | Who owns it |
|---|---|---|
| **Read** | Compress what goes *into* context | Compression proxies, provider-side context editing — crowded |
| **Write** | Cross-session *semantic* memory ("the user prefers X") | Mem0, Zep, Letta — crowded |
| **Reuse** | Replaying *how* a task was solved, so it is never re-derived | **The gap.** |

Read-path tools make every token cheaper. Reuse-path tools make most tokens **not
exist** — a categorically bigger lever. Compressing a 40-call exploration by 90% still
costs 40 round-trips, 40 chances for the model to wander, and 40 steps of latency. Not
doing the exploration costs ~0.

Why the adjacent tools don't close it:

- **Semantic memory** stores facts and injects them. The agent still runs the full
  control loop every step. **Recall ≠ replay.**
- **Compression** sits at the token-stream boundary, where *steps do not exist*. It can
  shrink a step; it cannot decline to run one.
- **Workflow engines** replay beautifully — but a human authors the workflow. The whole
  point of an agent is that nobody authored the procedure.
- **Prompt/skill files** are the manual, prose-shaped version. They prove the demand and
  reduce exploration; they are text the model re-interprets every run, not executable
  steps.

## The name

This is **memoization applied to agent trajectories**: cache the result of an expensive
computation (exploration), keyed by task class and environment fingerprint, with
invalidation by assertion and scoped repair rather than TTL. Hence **Rote**.

The two genuinely hard sub-problems — and therefore the moat:

- **Generalization** — which of the 40 recorded calls were essential rather than
  incidental, and which literals are actually *parameters* of the task class?
- **Self-healing** — the selector moved; repair the one broken step instead of falling
  back to full re-exploration.

## The three levers, in order of size

| Lever | Question | Plane |
|---|---|---|
| **Send less** | Why re-send a page that didn't change? | perception |
| **Call less** | Why re-derive a known procedure with a frontier model? | decision |
| **Remember** | Why does run #50 cost what run #1 cost? | learning |

Every fix lives *inside* the loop — what the model sees, when it's called, which model,
how actions are grounded. No external layer can retrofit that. It is why Rote is a
harness, not middleware ([02](02-architecture.md)).

## Where Rote fits — and where it doesn't

Being honest about the fit is load-bearing; the benchmark reports the losses too
([03](03-benchmark.md)).

**Strong fit**

- **Repeated portal work** — the same login → navigate → extract with different
  parameters, hundreds of times a day. Deterministic control flow, high repetition.
- **High-volume operational agents** — where the bill *is* the product.
- **Expensive observation loops** — enterprise DOMs where the page dwarfs the reasoning.

**Weak fit — say it out loud**

- **One-off sites.** Memoization pays nothing on a task that never recurs; matcher
  overhead is pure cost. Break-even ≈ 2 runs.
- **Open-ended browsing.** "Research this topic" has no procedure to reuse.
- **Sites that change meaning, not layout.** Repair handles a renamed selector. It
  cannot handle a changed business rule, and must not pretend to.
- **Creative work.** Out of scope by construction — the matcher must reliably *miss*
  these rather than confidently replay something wrong.

## Why browser agents are the right wedge

Browser workflows are simultaneously the **worst case for re-derivation** (DOM
exploration is the most token-expensive perception there is) and the **best case for
memoization** (portals and forms are relentlessly repetitive). Drift is testable —
mutate the DOM, watch the repair path. And the economics are legible: a token is a
token, and anyone can check the arithmetic.

Next: [02 — Architecture](02-architecture.md)
