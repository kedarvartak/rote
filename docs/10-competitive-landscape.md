# 10 — Competitive Landscape: Who Memoizes Browser Agents Today

> Status: **pivot plan**, surveyed 2026-07. Extends [04 — Market](04-market.md) with the
> browser-agent-specific question: *are browser-agent vendors already doing memoization?*
> Short answer: **yes, at the exact-repetition tier, inside their own harnesses — and
> nobody at the generalization tier or across harnesses.** That reshapes where Rote can
> win, and this doc is honest about it.

## The map

| Player | What they memoize | Granularity | Generalizes to novel tasks? | Harness-agnostic? |
|---|---|---|---|---|
| **Stagehand / Browserbase** | Resolved selector per `act()` call; server-side act-result cache on Browserbase | Single action | No — cache keyed on same action + page | No — Stagehand SDK only |
| **Skyvern** | Generated code per task/block ("code caching"); retrieves prior action plans by URL + goal match | Task / workflow block | Slightly — plan retrieval adapts a matched prior plan to current context | No — Skyvern runtime only |
| **Browser Use (workflow-use)** | Recorded/generated deterministic workflows with semantic selectors; LLM fires only on cache miss | Whole workflow | No — one workflow, dynamic variables, run at volume ("RPA 2.0") | No — Browser Use ecosystem |
| **Magnitude** | Deterministic caching (community discussion stage) | Action sequence | No | No |
| **OpenAI Operator / CUA, Claude computer use, Project Mariner** | Nothing published — screenshot-loop agents, fresh derivation every run | — | — | — |
| **Mem0 / Zep / Letta / Cognee** | Facts and conversational/semantic memory | Facts | N/A — wrong memory type (semantic, not procedural) | Yes |
| **Acontext** | "Skill files" — markdown learnings auto-captured from agent runs | Prose skills | Loosely — prose hints, no verification | Yes, but not browser-native |
| **Agent Workflow Memory (CMU, arXiv 2409.07429)** | Induced reusable workflows from trajectories, injected as context | Workflow fragments | **Yes** — +8.9–14.0 points cross-task/-site | Research code, not a product |

Sources: [Stagehand caching blog](https://www.browserbase.com/blog/stagehand-caching),
[Stagehand caching docs](https://docs.stagehand.dev/examples/caching),
[Skyvern code caching](https://www.skyvern.com/docs/developers/features/code-caching),
[workflow-use](https://deepwiki.com/browser-use/workflow-use)
([HN launch](https://news.ycombinator.com/item?id=44007065)),
[Magnitude discussion](https://github.com/magnitudedev/browser-agent/discussions/55),
[AWM paper](https://arxiv.org/abs/2409.07429).

## What the incumbents prove — and what they leave open

### Proven by their existence (good news for the thesis)
Every major open browser harness independently built repetition caching, and they publish
the numbers: Stagehand reports up to ~80% speedup on repeat runs; workflow-use markets
"LLM only on cache miss"; Skyvern makes cached runs "faster, cheaper, deterministic" with
automatic agent fallback. **The pain is real and validated** — re-derivation cost is
acknowledged by every serious player. Rote does not need to argue the problem exists.

### Left open (the gaps Rote targets)

1. **Generalization.** Every shipping cache is keyed on *sameness* — same action, same
   workflow, same URL+goal. None accumulates *site knowledge* that helps a task the
   harness has never seen on that site. The only demonstration of that is academic (AWM),
   with strong numbers and no product. This is Rote tier 3 (doc 08) — the pivot's core bet.
2. **Harness-agnosticism.** Each vendor's cache is a retention feature for *their* SDK.
   A team running mixed harnesses (or migrating between them) loses all memoization at
   the boundary. Rote at the MCP proxy layer serves any MCP-speaking harness and the
   memory *survives harness migration* — an argument no vendor can make, structurally,
   because their cache is their lock-in.
3. **Verification-first replay.** Stagehand validates page similarity before firing a
   cached selector; Skyvern falls back on failure. But none has Rote's contract:
   per-step assertions + final task-level verify + "never report success on failed
   verify" as a tested invariant + append-only versioned patches. For unattended
   enterprise fleets, auditable correctness is the buying criterion, not speedup.
4. **Cost observability.** Nobody reports *what re-derivation costs you* per site, per
   procedure, per source. Rote's tagged token accounting (invariant 5) makes the report
   ("your top 20 procedures and their replay hit rate", doc 02) a product surface no
   cache-as-a-feature bothers to build.

## Honest risks (steelman, extending doc 04)

- **"Good enough" built-ins.** A team all-in on Browser Use gets workflow-use for free.
  Rote must not pitch replay to them — it pitches the tiers they don't have
  (generalization, cross-harness memory, verification/audit). If T2 generalization fails
  its kill gate (doc 09), this risk becomes acute: replay-only Rote vs free built-ins is
  a weak position.
- **Harness vendors move up-stack.** Skyvern's plan retrieval ("adapt a matched prior
  plan to current context") is the closest thing to tier-3 thinking in a product. If a
  funded harness ships site memory before Rote proves it, first-mover is gone — speed to
  the doc 09 T2 benchmark matters more than polish.
- **Labs make it moot.** If frontier computer-use models get dramatically cheaper or
  natively remember across runs, the economics shrink. Mitigation is the same as doc 04's:
  Rote's artifacts (auditable playbooks, site memory, verification) are governance
  surfaces, not just cost savings — and cheaper models make the *distiller* cheaper too.
- **Memory-layer players go procedural.** Mem0 et al. own the "memory layer" mindshare
  and Acontext already stores procedural learnings as prose. Their gap is browser-native
  verification (selector confidence, landmark checks, assertion-gated replay) — prose
  skills can't be safely *executed*. Rote should own the word **verified** the way they
  own "memory."

## Positioning sentence

> Harness caches replay yesterday's workflow. **Rote remembers the website** — verified,
> versioned, harness-agnostic site memory that cuts exploration even on tasks your agent
> has never done there.
