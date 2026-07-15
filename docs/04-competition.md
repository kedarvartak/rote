# 04 — Competition

> Surveyed 2026-07. Optimization IDs (A4, C3, …) refer to
> [06 — Optimizations](06-optimizations.md).

## The field, in four strata

Rote competes in stratum 2, buys from 1, runs models from 4, and adopts 3.

```text
4. MODELS      GPT/CUA, Claude computer-use, Gemini/Mariner, Fara-7B, UI-TARS
3. STANDARDS   WebMCP (navigator.modelContext), MCP
2. HARNESSES   Browser Use, Stagehand agent, Skyvern, Magnitude, Notte, (Rote)
1. INFRA       Browserbase, Steel, Hyperbrowser, Anchor, Kernel, Browserless
```

## The harnesses (the direct competitors)

### Browser Use — the open-source default

Python OSS harness and the community Schelling point; cloud offering on top; a separate
`workflow-use` product for record-and-replay.

Their **DOM engine is the best-documented distiller in OSS** (CDP-coordinated
extraction, interactive-element detection, 95%+ re-walk cache hits, LLM-optimized
serialization). Above the observation layer the loop is conventional:
frontier-model-every-step, full re-observation each step, no diffs, no routing, no
cache-layout discipline; learning only via the separate, user-initiated recorder.

**Read:** they won distribution, not architecture. Their engine validates that perception
quality matters; everything above it is ordinary. **Rote vs:** match A1/A2 (table
stakes), win on A4/B2/B3/C3/D\*. Their mindshare is the real moat — the counter is a
reproducible head-to-head cost benchmark.

![Loop architecture: Browser Use vs Rote](diagrams/vs-browser-use.svg)

### Stagehand (Browserbase) — the SDK play

TS SDK (`act`/`extract`/`observe`/`agent`) over Browserbase infra. **C2 is their
signature**: self-healing `act` with resolved-selector caching and page-similarity
validation (~80% speedup on repeats). No diffs, no routing, no speculation, no cross-task
memory; the cache is per-action and framework-locked — it's their retention feature.

**Rote vs:** their per-action cache is a special case of site memory; Rote's is whole-loop
and infra-portable (including running *on* Browserbase). Expect them to move toward
memory — speed matters.

![Memory architecture: Stagehand vs Rote](diagrams/vs-stagehand.svg)

### Skyvern — the vision-first workflow product

The most efficiency-conscious incumbent: code caching (reusable code from successful
runs, per-block, auto-fallback to the agent when it fails — a real replay analog) and
prompt splitting. Vision-heavy planning makes the cold loop expensive, and reuse is
workflow-block-scoped.

**Rote vs:** cheaper cold loop (a11y-first hybrid), finer-grained learning, and a
verification contract — their fallback-on-failure is not the same as an assertion gate.

![Perception: Skyvern vs Rote](diagrams/vs-skyvern.svg)

### Magnitude, Notte, and the long tail

Vision-native challengers and thin wrappers. Interesting, small, and mostly orthogonal.

### Labs (Operator/CUA, Claude computer-use, Mariner)

Screenshot loops, no cross-run learning, premium pricing. They compete on **capability
ceilings**, not cost floors. Rote runs their models when needed — the harness is
model-agnostic, so lab progress is tailwind, not threat.

### WebMCP — adopt, don't fight

A site exposing `navigator.modelContext` tools is a perception plane that costs ~0
tokens. Rote's perception ladder is **WebMCP → distilled a11y → vision**. Being the most
WebMCP-forward harness is free differentiation while the standard matures.

### Infra — partners, not competitors

Browserbase, Steel, Hyperbrowser, Anchor sit behind one `SessionBackend` interface.
Portability is also user leverage. Anti-bot stealth is *their* lane and an arms race we
don't want to own.

## Capability matrix

Legend: ● ships it · ◐ partial/adjacent · ○ absent. **The Rote column is the designed
target, not today's build** — see [02 §Status](02-architecture.md) for what actually exists.

| Optimization | Browser Use | Stagehand | Skyvern | Magnitude | Labs | **Rote (target)** |
|---|---|---|---|---|---|---|
| A1/A2 distillation + element detection | ● | ◐ | ◐ | ○ | ○ | ● |
| A3 stable element IDs | ◐ | ○ | ○ | ○ | ○ | ● |
| **A4 diff observations** | ○ | ○ | ○ | ○ | ○ | ● |
| A7 elective vision (SoM) | ◐ | ◐ | ● always-on | ● always-on | ● always-on | ● elective |
| A8 token budget contract | ○ | ○ | ○ | ○ | ○ | ● |
| A9 WebMCP-first | ○ | ○ | ○ | ○ | ◐ | ● |
| B1 model routing | ○ | ◐ | ◐ | ○ | ○ | ● |
| B2 no-model replay | ◐ separate | ◐ action cache | ● code cache | ◐ | ○ | ● +verified |
| B3 cache-layout discipline | ○ | ○ | ◐ | ○ | n/a | ● |
| C1 settledness detection | ◐ | ◐ | ◐ | ◐ | ○ | ● |
| C2 self-healing resolution | ◐ | ● | ◐ | n/a | n/a | ● +memory-ranked |
| **C3 speculative execution** | ○ | ○ | ○ | ○ | ○ | ● |
| C6/F1 assertion-gated verification | ○ | ○ | ◐ | ○ | ○ | ● invariant |
| D1 lossless always-on recording | ○ | ○ | ◐ | ○ | ○ | ● built |
| D3/D4 site memory + prediction | ○ | ○ | ◐ | ○ | ○ | ● |
| G1 per-source cost accounting | ○ | ○ | ◐ | ○ | ○ | ● built |

The all-○ rows are the position: **no shipping harness has diff observations,
speculation, per-site compounding memory, cache-layout discipline, and assertion-gated
replay.** Several ship one. None ship most.

## Positioning

> **The browser agent that treats efficiency as the architecture, not a feature flag.**

Compression makes every token cheaper. Rote makes most tokens not exist.

## The hard objections, steelmanned

### 1. "The harness vendors will just build this"

The serious one. Response: what vendors ship first is **text-shaped** (skills files)
because it's easy; the executor + assertion + repair machinery is real systems work with
real depth. The moat isn't the executor code — it's the accumulated, repaired,
confidence-scored playbook library, and being the layer vendors *integrate* (MCP-native
from day one).

### 2. "Environments drift too fast; playbooks rot"

If true, replay hit rates collapse and Rote degrades into a worse agent. This is an
**empirical question with a designed answer**: the repair ladder makes drift a marginal
cost (patch one step) rather than a total one, and the drift tracker makes rot visible
instead of silent. B5 exists to measure the drift rate above which Rote stops paying. If
that threshold is below real-world drift, the thesis dies for the price of a benchmark —
which is the point of running it early.

### 3. "Token prices are collapsing; efficiency plays get commoditized"

**Latency and reliability don't collapse with token prices.** A 40-round-trip planned run
is slow and stochastically flaky at *any* price; a 6-call verified replay is fast and
reproducible. As fleets scale, the pitch shifts from "save money" to "make agent behavior
deterministic, auditable, and fast". Efficiency is the wedge; determinism is the durable
value.

### 4. "You're late" (the honest one)

Browser Use has ~2 years of community. Answer: we are not selling a harness, we are
selling a cost curve — and the benchmark is the go-to-market. If the number isn't there,
we don't launch on efficiency claims ([03](03-benchmark.md)).

![Capability landscape](diagrams/competitive-landscape.svg)

Next: [05 — Roadmap](05-roadmap.md)
