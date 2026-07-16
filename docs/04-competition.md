# 04 — Competition

> Surveyed 2026-07-16 against public docs and repos — **not** against competitor source.
> Optimization IDs (A4, C3, …) refer to [06 — Optimizations](06-optimizations.md).
>
> **The two findings that set the position:** reuse is table stakes (Skyvern ships our
> thesis, with branch coverage we don't design for), and no harness verifies that a
> replayed run was *correct*. We are late to memoization and early to two things:
> **verified** reuse, and **WebMCP** consumption.

Sources for the 2026-07 survey:
[Skyvern code caching](https://www.skyvern.com/docs/developers/features/code-caching) ·
[Stagehand caching](https://www.browserbase.com/blog/stagehand-caching) ·
[WebMCP reality check](https://studiomeyer.io/en/blog/webmcp-reality-check-may-2026) ·
[WebMCP browser support](https://dev.to/ai-agent-economy/webmcp-in-2026-which-browsers-support-navigatormodelcontext-complete-compatibility-status-1oe4) ·
[harness comparison](https://dev.to/stevengonsalvez/browser-tools-for-ai-agents-part-2-the-framework-wars-browser-use-stagehand-skyvern-4gn)

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
cache-layout discipline; learning only via the separate, user-initiated recorder. They
**re-reason at every step by design** — no cached selectors, so a layout change is simply
re-observed. That is robustness bought with tokens, and it is the clearest contrast with
both Rote and Stagehand.

**Read:** they won distribution, not architecture. Their engine validates that perception
quality matters; everything above it is ordinary. **Rote vs:** match A1/A2 (table
stakes), win on A4/B2/B3/C3/D\*. Their mindshare is the real moat — the counter is a
reproducible head-to-head cost benchmark.

![Loop architecture: Browser Use vs Rote](diagrams/vs-browser-use.svg)

### Stagehand (Browserbase) — the SDK play

TS SDK (`act`/`extract`/`observe`/`agent`) over Browserbase infra; v3 (2026-02) is a
CDP-native rewrite that dropped Playwright. **C2 is their signature**:
[self-healing `act`](https://www.browserbase.com/blog/stagehand-caching) with
resolved-selector caching and page-similarity validation before replay (~80% speedup on
repeats), re-invoking the model when a cached action fails. That pre-execution similarity
check is a cousin of our fingerprint gate — **the closest thing in the field to a guard
before reuse**, though it validates the *page*, not the *outcome*. No diffs, no routing,
no speculation, no cross-task memory; the cache is per-action and framework-locked — it's
their retention feature.

**Rote vs:** their per-action cache is a special case of site memory; Rote's is whole-loop
and infra-portable (including running *on* Browserbase). Expect them to move toward
memory — speed matters.

![Memory architecture: Stagehand vs Rote](diagrams/vs-stagehand.svg)

### Skyvern — the one that already ships our thesis

**Read this section before planning any reuse work.** Skyvern's
[code caching](https://www.skyvern.com/docs/developers/features/code-caching) is not an
analog of Rote's replay. It is the same product, shipped:

| Skyvern, today | Rote's equivalent |
|---|---|
| `run_with="agent"` records actions, **generates reusable code** | distiller — *not built* |
| `run_with="code"` — *"no screenshots, no LLM reasoning"* | replay executor — built |
| cached code fails → **auto-falls back to the agent, regenerates the cache** | repair ladder rung 3 |
| **progressive caching** — run 1 covers branch A, run 2 branch B, coverage compounds | not designed |

Their own words for it: *"faster, cheaper, and deterministic."* That is our pitch, in
their marketing copy, with branch coverage we do not yet design for. Vision-heavy planning
still makes their **cold** loop expensive — that part of the old read holds.

**The gap, and it is the only one that matters.** Their docs describe no explicit
verification that a cached run achieved the right *outcome*: the fallback triggers on
runtime errors, so **no exception thrown is treated as success.** Rote refuses that
assumption by construction (invariant 1).

This is not a theoretical distinction. Skyvern shipped a fix titled
[*"Fix cached click actions succeeding when element doesn't exist"*](https://github.com/Skyvern-AI/skyvern/actions/runs/21146235557)
(#SKY-7577) — a cached replay reporting success for a click that never landed. That is
exactly the T5 silent-drift failure [03](03-benchmark.md) classifies as a **design kill**,
arriving in their tracker as a *bug*, because their architecture permits it.

**Rote vs:** not "finer-grained learning" — that claim was wishful and is retracted.
The honest one: **verified** replay. Everyone can replay; nobody proves the replay was
right.

*Caveat: read from public docs and a commit title, not their source. Their fallback may
exceed what is documented, and a fixed bug is fixed. The architectural stance —
success-by-absence-of-error — is stated in their own docs.*

![Perception: Skyvern vs Rote](diagrams/vs-skyvern.svg)

### Magnitude, Notte, and the long tail

Vision-native challengers and thin wrappers. Interesting, small, and mostly orthogonal.

### Labs (Operator/CUA, Claude computer-use, Mariner)

Screenshot loops, no cross-run learning, premium pricing. They compete on **capability
ceilings**, not cost floors. Rote runs their models when needed — the harness is
model-agnostic, so lab progress is tailwind, not threat.

### WebMCP — where we are genuinely early

A site exposing `navigator.modelContext` tools is a perception plane that costs ~0 tokens
(Chrome's own framing claims ~89% token savings). Rote's perception ladder is
**WebMCP → distilled a11y → vision**.

**This is the one place the field is behind us rather than ahead**, and the window is
datable:

| Signal | State (2026-07) |
|---|---|
| Spec | W3C Draft Community Group Report, 2026-02-10 — *not* Standards Track |
| Chrome | 146 behind `enable-webmcp-testing`; **origin trial 149–156** |
| Edge | **147 ships native support** (Microsoft co-edits the spec) |
| Firefox / Safari | in the WG, no public timeline |
| **Agents consuming it** | **none.** Not Claude Desktop, ChatGPT Agent, Gemini, or Perplexity |
| **Harnesses consuming it** | **none documented** — Browser Use, Stagehand, Skyvern all absent |
| Infra | Cloudflare Browser Run ships WebMCP docs and advises `listTools()` first |
| Only bridge | MCP-B extension, ~5K users |
| Analyst mass-adoption target | **mid-2027** — a 12-month window |

**The chicken-and-egg, and why it does not bind us.** Publishers won't implement
`registerTool()` while agents ignore it; agents won't implement calling logic while no
site exposes tools. That standoff is what keeps everyone out — and it **dissolves for
first-party deployments**. Rote's best-fit buyer ([01](01-problem.md)) runs
high-repetition work against *internal* portals that the buyer's own organisation owns.
The publisher and the consumer are the same company. They do not need Amazon to adopt
WebMCP; they need one afternoon on their own vendor portal, and the reward is ~89% of the
perception bill.

That makes WebMCP-first perception the rare feature that is **early, cheap, standards-
aligned, and immediately deployable in exactly our segment** — while the incumbents wait
for the public web. Being the first harness that *consumes* WebMCP is a timing play with
a named expiry.

**The honest risk:** early may simply mean *not yet valuable*. If the spec stalls at
Community Group or Chrome lets the origin trial lapse, this is dead weight. The mitigation
is that it costs a rung on a ladder we already need — the fallback to distilled a11y is
the path we ship anyway, so a stalled standard costs us one adapter, not an architecture.
Sequenced at P3 in [05](05-roadmap.md); the case for pulling it earlier is that the window
closes ~mid-2027.

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

Read the **B2 row honestly**: Skyvern is a full ●, Stagehand and Browser Use are ◐.
Reuse is *table stakes among serious harnesses*, not our wedge. The differentiating
token in that cell is `+verified`, and nothing else.

## Positioning

> **The only harness that can prove the cheap path did the right thing.**

Reuse is table stakes — Skyvern, Stagehand and `workflow-use` all ship a version of it,
and Skyvern has shipped it longer than we have existed. **We are late to memoization, not
early.** Building the distiller and matcher reaches parity with Skyvern's 2026 baseline;
it passes nothing.

What no one ships is the **contract**: an assertion gate that decides success from page
state rather than from the absence of an exception, a fingerprint hard gate before any
reuse, and a repair ladder that makes drift a marginal cost instead of a silent wrong
answer. Skyvern's #SKY-7577 is the evidence that this is a real distinction and not a
slogan.

So the wedge is **efficiency**; the durable value is **determinism you can audit**.
Compression makes every token cheaper; Rote makes most tokens not exist — but a cheap
wrong answer is worth less than no answer, and we are the only ones architecturally
committed to that.

**Corollary for [03](03-benchmark.md):** a head-to-head on tokens is a fight against
harnesses with years of head start on the same idea. A head-to-head on **silent-failure
rate under drift** (B5/T5) is one no competitor is instrumented to run — their success
signal is "no exception thrown". Publish both; lead with the second.

## The hard objections, steelmanned

### 1. "The harness vendors will just build this"

The serious one. Response: what vendors ship first is **text-shaped** (skills files)
because it's easy; the executor + assertion + repair machinery is real systems work with
real depth. The moat isn't the executor code — it's the accumulated, repaired,
confidence-scored playbook library, and being the layer vendors *integrate* (MCP-native
from day one).

### 2. "Reuse is solved — Skyvern shipped it"

**Largely true, and the 2026-07 survey strengthened it rather than the reverse.** Skyvern
generates reusable code from agent runs, replays with zero LLM calls, falls back on
failure, and accumulates branch coverage. We do not have a distiller at all.

What is not solved is knowing the replay was *correct*. Their fallback fires on runtime
errors, so a replay that throws nothing is assumed right — which is how a cached click
"succeeded" against an element that did not exist (#SKY-7577). The claim is not that we
memoize better; it is that a memoized run is worthless unless something independent of the
model and independent of the absence-of-crash says it worked.

Retreat rule: if measurement shows their fallback catches outcome errors in practice as
well as our assertion gate does, **the verification wedge is gone and the project has no
position.** That is a benchmark, not an argument — B5/T5, and we should run it before the
token matrix.

### 3. "Environments drift too fast; playbooks rot"

If true, replay hit rates collapse and Rote degrades into a worse agent. This is an
**empirical question with a designed answer**: the repair ladder makes drift a marginal
cost (patch one step) rather than a total one, and the drift tracker makes rot visible
instead of silent. B5 exists to measure the drift rate above which Rote stops paying. If
that threshold is below real-world drift, the thesis dies for the price of a benchmark —
which is the point of running it early.

### 4. "Token prices are collapsing; efficiency plays get commoditized"

**Latency and reliability don't collapse with token prices.** A 40-round-trip planned run
is slow and stochastically flaky at *any* price; a 6-call verified replay is fast and
reproducible. As fleets scale, the pitch shifts from "save money" to "make agent behavior
deterministic, auditable, and fast". Efficiency is the wedge; determinism is the durable
value.

### 5. "You're late" (the honest one)

Browser Use has ~2 years of community; Skyvern has shipped caching-with-fallback for
longer than Rote has existed. **On reuse we are late, and the 2026-07 survey says so
plainly.** We are not selling a harness or a novel idea — we are selling a cost curve and
a verification contract, and the benchmark is the go-to-market. If the number isn't there,
we don't launch on efficiency claims ([03](03-benchmark.md)).

Where late is not the whole story:

- **Verification** — everyone replays; no one gates the replay on ground truth. Being
  second to reuse and first to *verified* reuse is a coherent position.
- **WebMCP** — a datable ~12-month window in which no agent and no harness consumes a
  standard that is already shipping in Edge 147, and which our own best-fit buyer can
  adopt first-party without waiting for the public web.

Both are narrower than "the efficient browser agent". Both are defensible. The old
positioning was neither.

![Capability landscape](diagrams/competitive-landscape.svg)

Next: [05 — Roadmap](05-roadmap.md)
