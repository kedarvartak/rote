# 01 — The Problem: Agents Re-Derive Everything

## One sentence

**Agents re-explore and re-derive already-solved workflows on every run, and no harness-level layer exists that captures a successful trajectory, generalizes it into a cheap-to-replay playbook, and self-heals it when the environment drifts.**

## The three token-spending paths of an agent harness

| Path | What it is | Who owns it today |
|------|-----------|-------------------|
| **Read path** | Compressing what goes *into* context (tool outputs, logs, search results) | Headroom, LLMLingua, provider-side context editing — crowded |
| **Write path** | Cross-session *semantic* memory ("the user prefers X", "the staging DB is Y") | Mem0, Zep, Letta/MemGPT, Cognee — crowded |
| **Reuse path** | Replaying *how* the agent solved something so it never re-derives it | **Nobody. This is the gap.** |

Read-path tools make every token cheaper. Reuse-path tools make most tokens **not exist**.
That is a categorically bigger lever: 90% compression of a 40-call exploration still costs 40
calls of latency, 40 round-trips of LLM control-flow, and 40 opportunities for the model to
wander. Not doing the exploration costs ~0.

## What re-derivation looks like in production

Watch any coding / browser / ops agent across two runs of the same task class:

- **Run 1**: 40 tool calls, ~200K tokens spent discovering how to run the test suite, where
  configs live, which env vars matter, what the deploy sequence is. Succeeds.
- **Run 2** (next day, fresh context): **the entire thing again, from zero.** Same greps,
  same dead ends, same tokens, same wall-clock.

The harness threw away the most valuable artifact it produced: the *procedure*.
Agents today have episodic amnesia not about facts (semantic memory solves that) but about
**skills**.

## Why the incumbents don't solve this

- **Semantic memory (Mem0/Zep/Letta)** stores *facts*, then injects them into the prompt.
  The agent still runs the full LLM control loop every step; facts shave a few dead ends
  but the trajectory is re-planned token-by-token every time. Recall ≠ replay.
- **Compression (Headroom)** is stateless per-request middleware at the LLM API boundary.
  It shrinks what the model reads; it cannot prevent a step from running, because at the
  token-stream level "steps" don't exist.
- **Workflow engines (Temporal, LangGraph graphs)** replay great — but a human has to
  *author* the workflow. The whole point of agents is that nobody authored the procedure.
  The missing piece is a machine that turns *agent-discovered* procedures into
  *engine-replayable* workflows automatically.
- **Prompt/skill files (CLAUDE.md, Claude Code skills)** are the manual, text-shaped version
  of this. They prove demand — teams hand-write "how we do X here" docs for their agents —
  but they're prose the LLM must re-interpret every run, not executable steps. Text hints
  reduce exploration; they don't eliminate the control loop.

## Why this problem is real (not a toy)

1. **The cost structure is inverted from what people optimize.** Everyone races on per-token
   price and compression ratio. The 10× lever is trajectory non-emission. Re-exploration is
   the largest hidden cost in production agent fleets — it just doesn't show up on any
   dashboard because nobody measures "tokens spent re-deriving known procedures."
2. **Repetition is the norm, not the exception.** Production agent workloads are heavily
   templated: "triage this ticket", "run the release checklist", "fill this vendor form",
   "regenerate this report". The long tail of novel tasks exists, but the head is fat and
   repetitive — exactly the shape memoization exploits.
3. **It compounds.** A compression proxy is as good on day 400 as day 1. A playbook library
   improves with every run and every repair — a data flywheel the stateless competitors
   structurally cannot have.
4. **It's measurable in one demo.** "Same task, run twice: 210K → 18K tokens, 90s → 8s,
   identical output." No benchmark gymnastics needed.

## The CS framing

This is **memoization applied to agent trajectories** — cache the result of an expensive
computation (exploration), keyed by task class and environment fingerprint, with cache
invalidation handled by assertions + scoped repair instead of TTLs. Hence the name: **Rote**.

The two genuinely hard sub-problems (and therefore the moat):

- **Generalization**: which of the 40 recorded calls were *essential* vs incidental noise,
  and which literal values are actually *parameters* of the task class?
- **Self-healing**: the selector moved, the API version bumped, the repo layout changed —
  repair the one broken step instead of falling back to full re-exploration.

Next: [02 — Architecture](02-architecture.md)
