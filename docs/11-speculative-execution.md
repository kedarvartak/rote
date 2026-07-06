# 11 — Speculative Execution: Overlapping Thinking and Acting

> Status: design. This doc defines Rote's core optimization for browser agents. It builds
> on the recorded-trajectory and playbook machinery of docs 02 and 08 — memory stops being
> only a replay cache and becomes the **predictor** that drives a speculative execution
> pipeline. [12 — Implementation Path](12-implementation-path.md) maps the existing code
> to this design.

## The problem: the agent loop is fully serialized

Every step of a browser-agent run pays two latencies **in series**, and neither shrinks
with experience:

```text
        ┌────────────┐        ┌──────────────┐        ┌───────────────┐
step N: │ model      │  ───▶  │ browser      │  ───▶  │ observation    │ ───▶ step N+1
        │ thinks     │        │ acts + loads │        │ fetch + encode │
        │ ~3–10 s    │        │ ~0.5–3 s     │        │ ~0.5–2 s,      │
        └────────────┘        └──────────────┘        │ 5–20K+ tokens  │
                                                      └───────────────┘
```

The browser is idle while the model thinks. The model is idle while the page loads. A
30-step task is 30 of these round-trips laid end to end — even on a site the agent has
completed the identical flow on before, because the agent re-derives every step from a
fresh observation. Two independent waste streams:

- **Latency**: total wall-clock ≈ Σ(model think + page load + observation fetch), with
  zero overlap.
- **Tokens**: each step re-ingests a near-identical page snapshot; accessibility-tree
  observations routinely exceed 20K tokens and enterprise pages reach 40K–500K.

Recent research attacks each half separately: speculative action execution with a draft
LLM as predictor (arXiv 2510.04371 — ~55% next-action accuracy, ~20% latency gains;
arXiv 2603.18897 "PASTE") and diff-based observations (arXiv 2604.01535, 2606.06708).
Neither is productized, and neither has a good predictor. **Rote's recorded trajectories
are that predictor**: a verified prior run on the same site predicts the next action
near-perfectly on stable flows — the difference between a static branch predictor and a
history-based one.

## Design thesis

> **While the model is thinking about step N, Rote — betting on what the agent will do
> next based on recorded experience — has already executed step N+1 and prepared its
> observation. A correct bet collapses the step to a confirmation. A wrong bet is
> discarded and costs nothing correctness-wise.**

Three properties are non-negotiable, and map onto the project invariants:

1. **Lossless** (invariant 1) — a speculated result is served to the agent only if the
   agent's *actual* next call matches the speculated call AND post-state assertions pass.
   Mispredictions are discarded and the real call executes normally. Speculation can
   never change *what* the agent does, only *when* the work happened.
2. **Never worse than baseline** (invariant 2) — with the predictor cold or disabled,
   the pipeline is a passthrough proxy; overhead is bounded and measured.
3. **Effects are sacred** — speculation never performs a server-mutating action.
   Forked sessions protect *our* state, not the target site's; a speculated form-submit
   would still hit their server. Hard rule: no speculation past the **effect boundary**.

## Where it sits

The same place the recorder already sits: the MCP proxy between the harness and the
browser MCP server (doc 02 "Where Rote sits"). The proxy gains a second job — it is no
longer just a *tap*, it is a *pipeline stage* that may answer calls from speculated
results instead of forwarding them. Harness-agnostic for the same reason the recorder is:
any MCP-speaking agent gets this without code changes.

```text
 harness/agent ──MCP──▶ ┌─────────────────────────── Rote proxy ─────────────────────────┐
                        │  recorder tap (unchanged, always on)                            │
                        │  session virtualizer: virtual session ↔ {live ctx, shadow ctxs} │
                        │  speculator: predict → classify → pre-execute → match → serve   │
                        │  observation differ: snapshot store → diff encoding             │
                        └───────────────┬───────────────────────────┬────────────────────┘
                                        ▼                           ▼
                                  live browser ctx          shadow browser ctx(s)
```

## Components

### 1. Predictor

**Input** (the *speculation context*): env fingerprint, the run's recent call history
(the last j tool calls with normalized args), and the current page identity (URL pattern
+ landmarks). **Output**: top-k candidate next calls with confidence:

```ts
interface Prediction {
  call: NormalizedToolCall;      // tool name + arg template, params bound where known
  confidence: number;            // calibrated P(next call matches), 0..1
  source: 'trace' | 'transition' | 'draft-llm';
  safety: SafetyClass;           // see §2
}
```

Three prediction sources, consulted in order of strength:

1. **Trace matching** (the branch history table). Match the run's call-history suffix
   against stored trajectories/playbooks of the same fingerprint. If the last j calls
   align with a recorded trajectory at position i, predict that trajectory's call i+1,
   with literal args re-bound through the playbook's param templating (doc 02) — so a
   recorded `fill(#vendor-name, "Acme")` predicts `fill(#vendor-name, {{vendor_name}})`
   and matches today's different value. Confidence from alignment length, trajectory
   success count, and freshness.
2. **Transition model**. A per-fingerprint first-order model over normalized calls:
   `count(context-hash → next-call-template)`, built by the distiller from *all* recorded
   runs (failed exploration included — it still says what agents do on this page).
   Covers the "agent is on a known page but not on a known flow" case.
3. **Draft LLM** (optional, off by default). A cheap-model guess for cold contexts, as in
   the speculative-actions literature. Goes through the shared LLM client with a new
   `predict` source tag (extends invariant 5's tag list — see doc 12).

The predictor is **pure logic** (CLAUDE.md modularity): `(context, memory) → Prediction[]`,
no I/O, no clock — property-testable, and benchmarkable offline against recorded
trajectories *before the pipeline exists* (this is the M3′ kill gate, §"Proving it
cheaply").

Calibration: every speculation outcome (hit/miss) is recorded per fingerprint; the
speculation threshold τ adapts so that expected saved latency exceeds expected wasted
work. A site where the agent behaves unpredictably quietly gets no speculation.

### 2. Action safety classifier

Every predicted call gets a `SafetyClass` that decides *where* (or whether) it may be
speculatively executed. Pure function over (tool name, args, site memory), closed enum:

| Class | Examples | Speculation policy |
|---|---|---|
| `pure-read` | get_dom / a11y tree, extract, screenshot, get_state, find_element | Execute live, any time — observing is free of side effects |
| `local-nav` | navigate(url) to a GET-safe URL, go_back, scroll, hover, open menu/tab | Execute in a **shadow context** (protects live session position); promotable on hit |
| `local-write` | fill, select, check — mutates page/session state, not the server | Shadow context only; promotable on hit |
| `effectful` | click on submit/delete/pay affordances, press Enter in a form, upload, anything the classifier can't prove GET-safe | **Never speculated.** Pipeline stalls here until the model confirms — like a memory fence |

Defaults are conservative and site memory can only *upgrade with evidence*: a `click` is
`effectful` unless recorded history shows it is navigation-only (same-page-set, no POST
observed in its wake), in which case it may be reclassified `local-nav` — recorded in the
store, versioned, with the observations that justified it (invariant 4). Downgrades on
any contrary observation are immediate.

Politeness rules (we speculate against servers we don't own): speculative requests are
capped per domain per minute, carry no retries, and only ever GET-equivalent traffic.

### 3. Session virtualizer

The harness holds a **virtual session**. The proxy maps it to one *live* browser context
plus zero or more *shadow* contexts:

- A shadow is created by cloning session state (cookies, localStorage/sessionStorage,
  current URL) into a fresh context — Playwright `storageState` semantics. It does **not**
  clone in-flight page JS state; the classifier only routes calls to shadows on pages
  where landmark checks confirm the clone reached an equivalent state, else the
  speculation is abandoned (counted, not silent).
- **Commit = promotion.** On a speculation hit whose action ran in a shadow, the proxy
  atomically re-points the virtual session at the shadow and disposes the old live
  context. The agent never knows; from its view, its call just returned unusually fast.
- **Discard** = dispose the shadow. Nothing else to unwind — this is why the effect
  boundary matters: only server-mutating actions would be un-discardable, and those are
  never speculated.

```text
model thinking about step N result …            time ──▶
proxy:   predict N+1 (conf .93, local-write)
         ├─ clone live → shadow S1
         ├─ execute predicted call in S1
         └─ capture result + observation diff, run expect checks
agent:   step N+1 call arrives
         ├─ matches prediction & checks passed → serve stored result, promote S1  [HIT]
         └─ differs → dispose S1, forward call to live context as normal          [MISS]
```

### 4. Matcher (speculation hit test)

A speculated result may be served only if **all** hold:

1. Tool name equal and args equal after normalization (URL canonicalization, whitespace,
   templated params bound to the same values). Near-misses are misses — no fuzzy serving.
2. The speculated execution's post-state passed its **expect checks** — page landmarks
   consistent with recorded post-state for this transition (reusing the Expect DSL and
   the executor's evaluator wholesale). A hit on a page that drifted is a miss.
3. The live context hasn't diverged since the clone (no interleaved non-speculated call).

`// INVARIANT:` all three checks precede serving; any failure falls through to normal
forwarding. This is the sacred-invariant suite's new surface (doc 12).

### 5. Observation differ

The token-side half, valuable with or without speculation. The proxy keeps, per virtual
session, the last-served snapshot of each observation kind. When the same observation is
requested again on the same page identity, it returns:

```jsonc
{ "mode": "diff", "base_seq": 41, "changes": [ /* added/removed/changed nodes */ ],
  "landmarks": ["#vendor-table"], "full_available": true }
```

- Full snapshot on first visit, URL-pattern change, or when the diff would exceed a
  size ratio (a diff bigger than ~60% of full is served as full — diffs must pay).
- Speculation pre-computes the diff for the predicted next page during the think-time
  window, so a hit serves both the action result *and* a ready observation.
- Adoption note, stated honestly: the model must understand the diff convention. Because
  we control the tool *result* payload we can do this transparently at the wire level,
  but quality depends on the harness's model handling diffs — we ship a one-paragraph
  system-prompt snippet for adopters and an off switch per session. Research basis:
  diff observations reduced tokens *and improved* task performance (arXiv 2604.01535).

### 6. Pipeline depth

v1 speculates exactly one step ahead. On high-confidence trace matches (a playbook-grade
flow), depth extends: speculate N+1..N+d until the first `effectful` call, which acts as
a fence. Each additional step multiplies misprediction cost, so depth is gated by the
calibrated per-site accuracy — this is where warm sites get dramatically faster while
cold sites silently stay at depth 0. Full replay (doc 02's executor) is the limiting case
of this design: an entire flow of confirmed predictions.

## What the win looks like

Per-step wall-clock, illustrative (units: seconds):

| | think | act | observe | step total |
|---|---|---|---|---|
| Baseline | 5 | 1.5 | 1 | 7.5 |
| Speculation hit (act+observe overlapped into think time) | 5 | 0 | ~0.1 (pre-diffed) | ~5.1 (−32%) |
| Speculation miss | 5 | 1.5 | 1 | 7.5 + ε (bounded prediction overhead) |

End-to-end saving ≈ hit-rate × (act + observe share of the loop), plus the token saving
from diffs (independent of hit rate). With trace-matched flows (hit rates ⪆90% on stable
sites, vs the literature's 55% with draft models), warm tasks approach think-time-bound
execution — the model's own latency becomes the only cost, and *that* is what replay
mode (doc 02) then removes for fully-verified flows. The two features form one spectrum:

```text
cold site          warm site                  verified playbook
depth 0            speculation depth 1..d     full replay
baseline speed     act/observe cost → 0       think cost → 0 too
```

## Failure modes and their answers

| Failure | Consequence | Answer |
|---|---|---|
| Misprediction | Wasted shadow work, bounded | Calibrated τ per site; accounting makes waste visible per run |
| Shadow clone diverges from live (JS state not cloneable) | Speculated result would be wrong | Landmark equivalence check at clone time; abandon speculation on mismatch (counted) |
| Speculated read has side effects we misjudged (analytics beacons, rate limits) | Target-site impact | GET-equivalent-only rule, domain rate caps, per-site opt-out |
| Diff observation confuses the model | Task quality drops | Off by default per harness until its eval passes; full snapshot always requestable |
| Predictor learns from a bad trajectory | Speculating garbage | Predictions from failed runs only feed the transition model's *page* statistics, never trace matching; hit-rate collapse auto-lowers τ |
| Interleaved human/harness action mid-speculation | Stale shadow | Divergence check (§4.3) — any non-speculated call invalidates outstanding speculations |

## Proving it cheaply (the kill gate, before building the pipeline)

The predictor is testable **offline** against data we already record: walk every stored
trajectory, feed the predictor the prefix, score its prediction of the next call. No
browser, no LLM, runs in CI. Kill gate: if top-1 next-action accuracy on
warm-site trajectories (fake-world suite + our own recorded runs) is **< 70%**, the
speculation thesis dies for the cost of a simulation harness — and if it passes, the same
simulation yields the projected latency-overlap number that becomes the live benchmark's
target. Full milestone sequencing in [12 — Implementation Path](12-implementation-path.md);
evaluation metrics join doc 09's suite (hit rate, overlap ratio, wasted-work ratio,
p50/p95 step latency, tokens per step with diffs on/off — all at success parity, which
remains non-negotiable).
