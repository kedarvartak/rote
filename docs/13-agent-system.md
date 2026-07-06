# 13 — The Rote Agent System: An Efficiency-First Browser Agent

> Status: design, 2026-07. **Direction change**: Rote is no longer only middleware for
> other harnesses — it is a **complete browser-agent system** whose differentiation is
> efficiency: fewest tokens, lowest latency, highest cache locality, and compounding
> per-site learning, at success parity with frontier harnesses. Docs 02 (replay),
> 08 (memory tiers), and 11 (speculative execution) are no longer add-on layers; they
> are **subsystems** of this agent. Doc 02's "Full runtime (later)" option is now the
> plan of record.

## Why build the harness instead of the layer

The middleware strategy (docs 02–12) had one structural weakness: every optimization
that matters most lives *inside* the harness loop — what the model sees (observation
building), when it's called (control flow), which model is called (routing), and how
actions are grounded. A proxy at the MCP boundary can intercept and advise, but it
cannot restructure the loop. Meanwhile the incumbent harnesses (Browser Use, Stagehand,
Skyvern, Magnitude — see [15 — Competitor Teardown](15-competitor-teardown.md)) each
ship *some* of the efficiency stack and none ship most of it. The open position is:

> **The browser agent that treats efficiency as the architecture, not a feature flag.**

Concretely, no shipping harness has all of: diff-based observations, memory-driven
speculative execution, per-site compounding memory, cache-locality-aware context
layout, model routing with small grounding models, and assertion-gated verified replay.
Rote has already designed and partially built the rarest of these (replay: built;
speculation + memory: designed in docs 08/11). The harness is the vehicle that lets
them all actually run.

What we keep from the middleware era: the MCP-native surface. Rote's browser tools are
themselves exposed over MCP, so Rote can still be *driven by* any MCP client — the
"harness" and the "layer" are one codebase with two entry points (own agent loop, or
tool server for someone else's loop). That preserves the adoption wedge while removing
the ceiling.

## The four-plane architecture

Everything in the system belongs to one of four planes. (Full component detail:
[16 — Harness Architecture](16-harness-architecture.md); the complete optimization
inventory each plane implements: [14 — Optimization Catalog](14-optimization-catalog.md).)

![Four-plane Rote architecture](diagrams/architecture.svg)

Solid borders identify the implemented foundation. Dashed borders identify target
harness capabilities; this distinction prevents the design direction from being read as
the current package surface.

The efficiency thesis, restated per plane:

| Plane | Baseline harness cost | Rote's answer | Expected effect |
|---|---|---|---|
| Perception | 5–40K tokens/step re-sent every step | distill → filter → diff → budget | 5–20× fewer observation tokens after step 1 |
| Decision | frontier model, every step, full context | route down or skip the model entirely | most steps off the frontier model on warm sites |
| Action | act → wait → observe, serialized | speculation overlaps act/observe with think | act+observe latency → ~0 on predicted steps |
| Learning | none — every run starts cold | compounding per-site memory | tokens/task falls with site experience (doc 09 learning curve) |

## The efficiency loop (one step, end to end)

```text
 1. task arrives → fingerprint gate → site brief injected (≤1K tok, doc 08 tier 3)
 2. playbook match?  ── yes ─▶ verified replay (doc 02), LLM only for slots      [~0 model steps]
 3. no → agent loop:
    a. settledness detector says page is ready
    b. perception compiler emits DIFF observation within token budget
    c. router picks executor: memory-predicted? → speculation already ran (doc 11)
       routine grounded action? → small model     ambiguous/recovery? → frontier
    d. action dispatched (or confirmed, if speculated); expect check runs
    e. recorder logs everything; transition model updates
 4. task verify[] gate → success is only reported if verification passes (invariant 1)
```

## What "efficient" means, measurably

The headline metrics (benchmark detail in docs 03/09, extended for the full system):

1. **Tokens per completed task** vs Browser Use / Stagehand-agent / CUA-class agents on
   the same task suite, at success parity — the doc 03 methodology, now first-party.
2. **Wall-clock per completed task** — speculation + settledness + small-model routing
   are latency plays; target: warm flows bounded by think-time only (doc 11).
3. **Marginal cost curve** — tokens/task as a function of accumulated site experience
   (doc 09's learning curve). Baseline harnesses are flat; Rote must fall.
4. **$ per 1K tasks** — the fleet-operator number, combining model spend + browser
   infra time (latency is compute cost when sessions are hosted).
5. **Success parity, per condition** — efficiency claims are void where success drops
   (invariant: never worse than baseline, now measured against *other harnesses* too).

## Positioning against the field

(Evidence and per-competitor detail in [15](15-competitor-teardown.md).)

- **vs Browser Use** (the OSS default): they own mindshare and a good DOM distiller;
  their loop is still frontier-model-every-step, no diffs, no speculation, workflow
  reuse only via a separate record-first product (workflow-use). Rote's pitch: same
  open-source surface, structurally lower cost per task, and learning that compounds
  without asking the user to record workflows.
- **vs Stagehand/Browserbase**: they own the SDK + infra bundle; caching is
  per-action selector memoization. Rote's pitch: whole-loop efficiency, not per-call;
  infra-agnostic (runs on Browserbase, Steel, Hyperbrowser, or local Chrome).
- **vs Skyvern**: closest in spirit (code caching, prompt splitting, fallback agent);
  vision-heavy loop is token-expensive cold, and reuse is workflow-block-scoped.
  Rote's pitch: cheaper cold loop (a11y-first hybrid) and finer-grained learning.
- **vs labs (Operator/CUA, Claude computer-use, Mariner)**: screenshot loops with no
  cross-run learning and premium pricing; they compete on capability ceilings, not
  cost floors. Rote runs *their* models when needed — the harness is model-agnostic,
  so lab progress is tailwind, not threat.
- **vs WebMCP** (the standard, not a competitor): adopt aggressively — a site exposing
  `navigator.modelContext` tools is a perception plane that costs ~0 tokens. Rote's
  perception compiler treats WebMCP tools as the highest-priority observation source
  and falls back down the ladder (a11y distill → vision) when absent. Being the most
  WebMCP-forward harness is free differentiation while the standard's origin trial
  (Chrome 146+) matures.

## Risks, named

1. **We are late to the harness market** (Browser Use ~2 years of community). Answer:
   we are not selling a harness, we are selling a cost curve; the benchmark (doc 03/09
   discipline, now against competitors) is the go-to-market.
2. **Frontier models get cheap enough that nobody cares.** Answer: the same forces
   multiply agent deployment volume; fleet operators' bills grow either way, and
   latency (speculation's win) doesn't fall with token prices.
3. **Scope explosion** — a full harness is a much bigger build than middleware. Answer:
   the build plan (doc 16 §Build order) ships the loop skeleton first and pulls each
   optimization from the catalog by measured ROI, and the recorder/executor/schemas
   already built carry over unchanged.
4. **The invariants get diluted under harness pressure.** Non-answer: they don't.
   Invariants 1–5 (CLAUDE.md) bind the agent loop exactly as they bound the middleware.

Next: [14 — Optimization Catalog](14-optimization-catalog.md)
