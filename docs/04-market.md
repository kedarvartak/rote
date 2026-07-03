# 04 — Market Pressure Test

## Positioning in one line

> **Headroom makes every token cheaper. Rote makes most tokens not exist.**
> Compression is the read path; semantic memory is the write path; **Rote owns the reuse
> path — procedural memory with deterministic replay.**

## Competitive map

| Player | Layer | What they do | Why they don't cover the reuse path |
|---|---|---|---|
| **Headroom** | LLM API boundary | Compress everything the model reads (70–95% ratios, CCR retrieval store) | Stateless, per-request, token-level. No step structure → cannot prevent a step from running. **Complement, not competitor.** |
| **Mem0 / Zep** | Prompt injection | Semantic memory: extract + recall facts across sessions | Facts shave dead ends; the LLM still re-plans every step. Recall ≠ replay. No executor, no assertions, no repair. |
| **Letta (MemGPT)** | Agent runtime | Self-editing memory hierarchy inside their agent framework | Memory is still *text the LLM reads*. Also a framework — teams with existing harnesses won't rebase; Rote wraps what they have. |
| **Cognee / RAG-memory tools** | Retrieval | Knowledge graphs over past data | Same category error: knowledge, not procedure. |
| **Temporal / n8n / workflow engines** | Orchestration | Deterministic, durable replay of *hand-authored* workflows | The authoring is the whole problem. Rote is the compiler from agent exploration → workflow. (Temporal is a plausible *execution substrate* under Rote, and a plausible acquirer.) |
| **LangGraph / CrewAI graphs** | Framework | Developer-defined control-flow graphs | Human authors the graph at dev time; Rote learns it at runtime. Also: integration target, not competitor. |
| **Anthropic Skills / CLAUDE.md / prompt playbooks** | Text | Hand-written "how to do X here" docs the agent reads | **The strongest market validation**: teams already hand-author procedural memory. But it's prose — re-interpreted by the LLM every run, no determinism, no assertions, no self-healing, no automatic capture. Rote is this, compiled. |
| **Voyager / AWM (research)** | Academic | Skill libraries learned from experience (Minecraft; agent workflow memory) | Proves the concept works; nobody has productized it as drop-in harness middleware. The papers are our literature review, not our competition. |

## The three hard objections (steelmanned)

### 1. "Harness vendors will just build this" (the platform-risk objection)
The serious one. Claude Code skills, OpenAI's memory, LangGraph checkpointing all gesture
in this direction.

Response:
- Vendors build *within their walls*. Fleets are heterogeneous (a Claude Code dev agent, a
  LangGraph support agent, an in-house browser agent) — the playbook store that works
  *across* harnesses, with one audit surface, is a neutral-layer play vendors are poorly
  positioned to own. Same structural reason Headroom can exist despite provider-side
  prompt caching.
- What vendors ship first is text-shaped (skills files) because it's easy. The executor +
  assertion + repair machinery is a real system with real engineering depth — a 12–18
  month head start is winnable.
- Mitigation strategy: be the layer vendors *integrate* (MCP-native from day one), and
  make the playbook store the sticky asset — the moat is the accumulated, repaired,
  confidence-scored library, not the executor code.

### 2. "Environments drift too fast; playbooks rot"
If true, replay hit rates collapse and Rote degrades into a worse agent.

Response: this is an empirical question with a designed answer — the repair ladder makes
drift a *marginal* cost (patch one step) instead of a total one (re-derive everything), and
the drift tracker makes rot *visible* instead of silent. The wedge benchmark's B5 suite
exists precisely to measure the drift rate above which Rote stops paying. If that threshold
turns out to be below real-world drift rates, the thesis dies in week 3 for the price of a
benchmark — that's the point of the wedge.

### 3. "Token prices are collapsing; efficiency plays get commoditized"
Response: latency and reliability don't collapse with token prices. A 40-round-trip
LLM-planned run is slow and stochastically flaky at *any* price; a 6-call deterministic
replay is fast and reproducible. As fleets scale to thousands of runs/day, the pitch shifts
from "save money" to "make agent behavior **deterministic, auditable, and fast**" —
compliance teams pay for replayable, versioned, human-readable procedures independent of
token economics. Efficiency is the wedge; determinism is the durable value.

## Who buys, and what they buy

| Segment | Pain today | What Rote sells them |
|---|---|---|
| Teams running agent fleets in prod (support, ops, RPA-replacement) | Cost + latency + flakiness at scale | Warm-path economics, deterministic behavior |
| Coding-agent platforms / internal dev-agent teams | Every session re-learns the repo | Cold-start elimination (the "setup tax" refund) |
| Browser-automation / web-agent products | DOM exploration burns tokens; selectors rot | Replay + self-healing (their two top costs, one layer) |
| Compliance-sensitive verticals (fintech, health) | "What exactly did the agent do?" | Versioned, auditable, human-readable playbooks |

Business model shape: open-source SDK + recorder (adoption), paid control plane —
hosted playbook store, drift dashboard, cross-fleet sharing, audit/export (revenue).
The Headroom-style "show a violent % number in the README" go-to-market applies directly.

## Why now

- Agent fleets crossed from demos to production in 2025 — repetition at scale now exists.
- MCP standardized the tool-call boundary — a portable interception point that didn't
  exist two years ago is what makes a *neutral* reuse layer technically feasible.
- The read path (Headroom) and write path (Mem0 et al.) getting funded and adopted has
  educated the market that harness-level token layers are a category. The reuse path is
  the obvious next shelf in that aisle — currently empty.

Next: [05 — Roadmap](05-roadmap.md)
