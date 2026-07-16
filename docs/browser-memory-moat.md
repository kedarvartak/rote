# Browser Memory Moat

> Recorded 2026-07-17. **Status: an observation with measurements, not a shipped claim.**
> The curve described here has not been drawn against a competitor, and two of the four
> techniques below are not built. Read [02 §Status](02-architecture.md) before believing
> any capability statement.

## The observation

> **Everyone optimizes the constant. Nobody has fixed the exponent.**

Agent loops re-send their whole transcript every step. A run of *n* steps therefore sends
`1 + 2 + … + n` prompt-units: **cost is O(n²) in task length.**

Every optimization the field is fighting over — better DOM serializers, element filtering,
vision-vs-a11y, prompt splitting — shrinks the *per-step* prompt. Those lower the
constant. **The exponent is untouched.** No shipping harness owns prompt layout as an
architectural rule, which is what it takes to attack the quadratic term.

This is the one place where the field is behind us for a reason we can articulate, rather
than a reason we hope is true.

## Why browsers specifically

Browsers are the pathological case, and the pathology is also the exploit:

| Property | Consequence |
|---|---|
| Observations are **enormous** — a real page is 5–40K tokens of DOM | the per-step constant is huge |
| Observations are **highly redundant** — ~95% of a page is byte-identical after one click | almost all of it is re-sent waste |
| Observations are **sequentially correlated** — step *n+1* differs from *n* by a few nodes | the redundancy is *computable* as a diff |

A general agent with 200-token observations has a quadratic nobody notices. A browser
agent with 20K-token observations has one that dominates the bill by step 10.

## Measured: Rote's own curve

Live runs, 2026-07-16, `gpt-5.6-luna`, frozen B1–B3 fixtures (see
[T1](testing/T1-openai-dry-run.md) for the harness setup).

**B2 — vendor registration, 10 steps, input tokens per planner call:**

```
637 → 677 → 716 → 759 → 800 → 839 → 876 → 917 → 953 → 881
```

**B1 — report download, 5 steps:**

```
418 → 452 → 489 → 519 → 588
```

| Run | Steps | First → last | Growth | Total input | If flat | Re-sent history |
|---|---|---|---|---|---|---|
| B2 | 10 | 637 → 881 | **+38%** | 8,055 tok | 6,370 | **1,685 tok = 21% of the input bill** |
| B1 | 5 | 418 → 588 | **+41%** | 2,466 tok | 2,090 | **376 tok = 15% of the input bill** |

**A fifth of B2's input spend is re-reading text we already sent** — on a 10-step task
against a page that distills to 10 nodes. Both numbers are lower bounds on the real
effect: these fixtures are toys.

## What actually grows

From `packages/agent/src/context.ts`, per planner call:

| Segment | Size | Behavior |
|---|---|---|
| `stablePrefix` — instructions, task, action schema, expect guidance | ~268 tok | **constant** |
| `Current page: {title} \| {url}` | ~20 tok | constant |
| `Previous actions:` — one JSON action per prior step | **~35–40 tok/step** | **grows linearly** |
| `Compact observation ({mode})` | ~135 tok (B2) | constant per page, re-sent fresh |

So step *n* costs `268 + 20 + 40n + obs`, and the sum over *n* steps carries a
`40 · n(n+1)/2` term. That term is the parabola. **The measured +35 tok/step matches one
action JSON exactly** — the arithmetic and the telemetry agree, which is why this is an
observation rather than a theory.

## The four techniques

| Technique | Effect on the curve | Status |
|---|---|---|
| **Drop old observations** — keep what the agent *did*, not what it *saw* | kills the dominant quadratic term | ✅ **built** (and unclaimed) |
| **Diff the current observation** — send `+added / ~updated / -removed` | −~90% on the constant, on real pages | ⚠️ **built, never fires** |
| **Prefix-cache `[stable][history]`** | 10× off the surviving quadratic term | ❌ **not built** |
| **Scheduled compaction** of action history | history → O(1); curve → linear | ❌ not built (P2) |
| **Replay** | 0 steps, 0 tokens | ❌ needs the distiller (P2) |

### 1. Dropping observations — the win we already have and never named

The standard agent pattern is a chat transcript:

```
[system, user(obs₁), assistant(act₁), user(obs₂), assistant(act₂), …]
```

**Every observation stays in context forever.** At 5–40K tokens each, step 20 is a
100–800K token prompt. This is what the chat API shape encourages, and it is the
catastrophic version of the quadratic.

`assemblePlannerContext` does not do this. It sends `previousActions` — the action
history — and `options.observation`, **singular and current**. Prior observations are
dropped on the floor.

That is why growth is 35 tok/step rather than 135+/step: B2's observation is ~135 tokens,
and if observations accumulated, growth would be at least that. **It is 35. The
measurement proves the architecture.**

**The trade, stated honestly:** the model remembers what it *did*, not what it *saw*.
That is correct for form-filling and navigation. It will fail on tasks requiring recall of
earlier page content — *"compare the prices of three products"* — where the answer lives
in observations we discarded. This is a real limit and belongs in
[01 §fit](01-problem.md), not in a footnote.

### 2. Diffing — built, tested, and inert

`packages/perception/src/adaptive-render.ts` degrades **full → diff → summary** as the
budget tightens. It works and it is property-tested.

It has never fired in anger. The default budget is 4,000 chars; B2's observation is 537.
Every observation to date renders `full`. **The mechanism built to exploit the ~95%
redundancy has never once met a page redundant enough to trigger it** — our fixtures are
too small. Until a real page runs, A4's value is a hypothesis.

### 3. Caching — the claim is currently false

[04](04-competition.md)'s capability matrix marks **B3 cache-layout discipline** as ●
for Rote. **It is not built.** What exists is a stable/volatile string split in
`context.ts` with nothing acting on it:

- **No `cache_control` breakpoints are ever sent.** Anthropic requires them explicitly;
  without them there is no caching at all, regardless of how well-ordered the prompt is.
- **The accounting cannot see a cache hit.** `packages/llm/src/{anthropic,openai}.ts` read
  `usage.input_tokens` and `usage.output_tokens` and nothing else.

The action history is **append-only**, which makes it an ideal caching target: step *n*'s
history is step *n−1*'s plus one action, so `[stable][history]` is a growing prefix, and
the observation already sits last. The structure is right. The mechanism is absent.

#### The provider asymmetry trap — a live integrity bug

> **Anthropic's `usage.input_tokens` EXCLUDES cache reads** (they appear in
> `cache_creation_input_tokens` / `cache_read_input_tokens`).
> **OpenAI's `usage.input_tokens` INCLUDES them** (broken out under
> `input_tokens_details.cached_tokens`).

Rote reads only `input_tokens` on both and treats them identically. Consequences:

1. **Turning on caching today would produce a fake win.** Reported `input_tokens` would
   collapse on Anthropic — not because fewer tokens were used, but because they moved to a
   field we do not read. A benchmark that reports an efficiency gain that did not happen is
   an invariant-1 violation living inside the instrument.
2. **`--cache-adjusted true` has no data behind it.** The head-to-head runbook
   (`scripts/bench/headhead/README.md`) says to set it only if the counts are the tokens
   actually billed. We cannot currently know that.
3. **The same run on two providers reports different totals** for reasons unrelated to
   efficiency.

**Fix the accounting before the caching.** Reading the cache fields is a prerequisite, not
a follow-up.

#### The fixtures cannot show any of this

Both providers require ~1,024 tokens before prefix caching applies at all. B2's per-call
prompts are **637–953 tokens** — under the line on every single call. **Caching, if built
today, would do exactly nothing on our benchmark.**

That is its own finding: the distiller made the prompts too small to cache. Distillation
and caching are not competitors — they act on different terms — but they *appear* to be at
toy scale, and the caching win only materializes on real pages with real history.

### 4. The tension: caching versus compaction

They fight.

- **Caching** requires the prefix to be immutable — one changed byte above the line
  invalidates everything below it.
- **Compaction** rewrites the history to keep it bounded — which mutates the prefix.

Compact every step and you cache-miss every step: you have paid for both mechanisms and
bought neither. The resolution is amortization — compact on a schedule and eat one miss
every ~*k* steps. [02](02-architecture.md) already says *"History compaction in the context
assembler, **cache-economics-scheduled**"*. The right answer is written down and unbuilt.

## Why this could be a moat rather than a feature

The honest objection: *"it's just caching — anyone can reorder a prompt in a weekend."*

The 50 lines of `cache_control` are indeed trivial. The **discipline** is not. Prefix
caching rewards a property that feels unnatural to write:

> **Nothing above the line may ever mutate.** Not a timestamp, not a run id, not a
> reordered tool schema, not a "helpful" recency reshuffle.

Most harnesses cannot guarantee that because **nothing owns prompt layout** — it is
assembled ad hoc across the codebase, wherever a message gets appended. Retrofitting the
guarantee means finding every writer and constraining it. Rote has a single
`ContextAssembler` that owns layout as an architectural rule, and
[02](02-architecture.md) commits to a test that fails if a volatile token lands above the
stable line.

That is the same shape as invariant 1: **not clever code, an enforced constraint.** Those
are the ones that are hard to copy, because copying them means changing how your codebase
is allowed to be written.

## Relation to the other candidate wedges

| Candidate | Verdict |
|---|---|
| **Verified reuse** | True, and narrow. A safety floor, not a headline. Nobody tweets about an assertion gate. |
| **WebMCP-first** | Killed on evidence 2026-07-17: a customer SPA's 4MB bundle contains **zero** WebMCP markers (`modelContext`, `registerTool`, all 0). First to an empty room. See [04](04-competition.md). |
| **The cost curve** | Needs no site cooperation, no fight, and is measured on the **provider's** receipts rather than ours. The demo is one graph. |

## What is unproven

This is the honest ledger. Everything above is either measured or arithmetic; everything
below is not yet known.

1. **The curve has never been drawn against a competitor.** "They're quadratic, we're
   linear" is inference from architecture, not measurement.
2. **Rote is not actually linear** — it is a smaller-constant quadratic. Linear requires
   compaction (unbuilt).
3. **Diffing has never fired.** Its ~90% claim is untested at any real page size.
4. **Caching is unbuilt, unmeasurable, and would currently report a fake win.**
5. **The dropped-observation trade has never been stress-tested** on a task that needs
   recall of earlier pages.

## Next

Measure before building. The claim *is* a curve, so draw it: cumulative tokens versus step
count, Rote against Browser Use, same task, same model, **on a real page** — the fixtures
are too small for diffing to trigger or for caching to be legal, which is precisely why
none of this has surfaced in our numbers yet.

That answers, in one experiment: whether the competition is quadratic where we are not,
how bad the naive transcript pattern actually is, and whether A4 does anything once a page
is big enough to fire it.

**Fix first, in order:** (1) read the cache fields in `@rote/llm` — the accounting bug
outranks the optimization; (2) draw the curve; (3) then decide whether `cache_control` and
compaction earn their place in V1.
