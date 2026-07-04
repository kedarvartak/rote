# 02 — Architecture

![Architecture](diagrams/architecture.svg)

## Design thesis

> **Control flow should be deterministic. The LLM's job is content and repair, not navigation.**

A successful agent run contains two kinds of information tangled together: *what to do*
(the procedure) and *what to say/fill/decide* (the content). Rote untangles them. The
procedure gets compiled into a deterministic, replayable artifact; the LLM is invoked only
where genuine judgment is needed — binding parameters, filling content slots, and repairing
broken steps.

## Where Rote sits (and why it's not a proxy)

Rote is **harness middleware at the tool-call boundary** — a wrapper around the harness's
tool dispatch layer — *not* a proxy at the LLM API boundary (where compression middleware sits).

This placement is the load-bearing decision:

- At the tool-call boundary you see **structured steps**: tool name, arguments, result,
  timing, and which later steps consumed which earlier outputs. That structure is what makes
  a trajectory compilable into a DAG.
- At the LLM API boundary you see a flat token stream. You can compress it, but you cannot
  *not run* a step, because steps don't exist there.
- Consequence: **Rote composes with compression middleware.** Rote decides whether steps
  execute at all; compression shrinks whatever still flows to the model. They are different
  layers, not competitors.

Integration surface, in order of shipping priority:

1. **SDK wrapper** — wrap the tool-executor of an existing harness (Claude Agent SDK,
   Vercel AI SDK `tools`, LangGraph nodes, MCP server shim). ~10 lines to adopt.
2. **MCP proxy** — an MCP server that fronts other MCP servers, recording and replaying
   transparently. Zero harness changes; instantly compatible with every MCP client.
3. **Full runtime** (later) — Rote as the executor, harness as a plugin.

## Components

### 1. Recorder
Taps every tool call during normal agent runs: `(tool, args, result_digest, t, run_id)`,
plus the task spec, env fingerprint (tool inventory, repo/URL identity, versions of key
surfaces), and final outcome. Cheap, always-on, append-only log. No LLM involvement.

### 2. Distiller (post-run, offline LLM pass)
Converts a *successful* trajectory into a **playbook**. This is where the hard
generalization work happens, and it runs off the critical path (async, batchable, can use a
big model because it runs once per learned task, not once per execution):

- **Causal pruning** — build the dependency graph of which call outputs actually fed later
  arguments or the final answer; drop dead-end explorations (typically the majority of a
  cold run).
- **Parameterization** — identify literals that are task *inputs* (ticket ID, branch name,
  form values) vs environment *constants*, and lift inputs into typed slots.
- **Assertion synthesis** — for every step, emit a cheap postcondition ("expect" block):
  exit code, selector exists, JSON path present, output matches shape. Assertions are the
  immune system of replay — without them, replay silently produces garbage when the world
  drifts.
- **Verification plan** — a final end-to-end check distilled from how the original run knew
  it had succeeded.

### 3. Playbook Store
Versioned, content-addressed store of playbooks. A playbook is a parameterized step DAG:

```yaml
playbook: submit-vendor-invoice
version: 3                      # patches bump versions; history kept
task_signature:
  intent_embedding: <vec>
  env_fingerprint: {domain: vendors.acme.com, tools: [browser.*]}
params:
  - {name: invoice_id, type: string}
  - {name: amount, type: money}
steps:
  - id: open_portal
    tool: browser.navigate
    args: {url: "https://vendors.acme.com/invoices"}
    expect: {selector_visible: "#invoice-table"}
    on_fail: repair            # repair | retry(n) | fallback
  - id: fill_form
    tool: browser.fill
    args: {selector: "#amount", value: "{{amount}}"}   # slot
    expect: {input_value: "#amount", equals: "{{amount}}"}
  - id: judgment_slot          # LLM-filled content, not LLM control flow
    llm_fill: {prompt: "summarize dispute reason from {{context}}", max_tokens: 200}
verify:
  - {text_visible: "Invoice submitted"}
confidence: 0.94               # updated every run (see Drift Tracker)
```

Three step kinds, deliberately minimal:
- **Deterministic step** — tool + bound args. Zero LLM tokens.
- **Slot step** — LLM fills a value/content field. Small, scoped call (can be a cheap model).
- **Judgment gate** — rare explicit branch where the original run genuinely decided
  something from data; encoded as a constrained LLM classification, not free-form planning.

### 4. Matcher
At task intake, decide: replay or explore. Two-stage to keep it fast and safe:

1. **Structural filter** — env fingerprint must match (same tool inventory, same target
   system identity). Hard gate; no fuzzy matching across environments.
2. **Semantic match + bind** — embedding similarity on task intent shortlists candidates;
   one small LLM call confirms the match *and extracts parameter bindings* in the same shot.
   Below threshold τ → miss → full agent run (which becomes new training data).

A miss costs one cheap LLM call. A false-positive match is the dangerous failure mode —
which is why replay is assertion-gated at every step rather than trusted.

### 5. Replay Executor
Walks the DAG. Deterministic steps dispatch straight to tools — the LLM planner is not in
the loop. Every step's `expect` block is checked; slot steps invoke a scoped, cheap LLM
call. Cost per warm run ≈ match call + slot fills + verification. That's the floor the
economics trend toward.

### 6. Repair Agent (self-healing)

![Repair ladder](diagrams/repair-ladder.svg)

On assertion failure, escalate a **repair ladder** — never fail the task, never silently
continue:

1. **Retry** — transient failures (network, timing) per step policy.
2. **Scoped repair** — spin up an LLM with a *narrow* context: the failing step, its
   expected postcondition, current observed state, and the playbook's intent for that step.
   It re-derives just that step (find the moved button, the renamed flag, the new API path),
   emits a **patch**, replay resumes. Patches are additive and versioned (`vN+1`) — bad
   patches roll back, and patch history is itself signal about environment volatility.
3. **Fallback** — full agent run on the original task; the recorder captures it and the
   distiller re-learns. Worst case equals today's status quo cost — Rote's failure mode
   is "no worse than not having Rote."

This matches the field-tested pattern: *deterministic playbooks, LLM fills content,
explore once, repair with persisted patches.*

### 7. Confidence & Drift Tracker
Per-playbook health: success streak, repair frequency, time since validation. Confidence
gates matching (low-confidence playbooks require re-verification or shadow replay).
Rising repair frequency on one surface = drift alert — proactively re-distill instead of
degrading run-by-run. This is also the observability product surface: "your top 20
procedures, their replay hit rate, and what re-derivation is costing you."

## Run lifecycle economics

![Run lifecycle](diagrams/run-lifecycle.svg)

| | Cold (run 1) | Warm (run N) | Drift (run N+k) |
|---|---|---|---|
| LLM in control loop | every step | never | one step |
| Tool calls | ~40 (incl. dead ends) | ~6 (essential only) | ~8 |
| Tokens (illustrative) | ~210K | ~18K | ~31K |
| Artifact produced | trajectory → playbook v1 | confidence++ | patch → v2 |

The marginal cost of a memoized task trends toward the **verification floor**: the price of
proving the replay still holds. That floor is the honest lower bound — you never get to
zero, because trusting an unverified replay is how you ship wrong answers.

## Failure-safety invariants

1. **Never silently wrong** — every replayed step is assertion-gated; final verify block
   must pass or the run escalates the repair ladder.
2. **Never worse than baseline** — full-agent fallback is always available; a Rote failure
   costs one wasted match call.
3. **Never cross environments** — structural fingerprint is a hard gate; a playbook learned
   on staging cannot fire on prod unless fingerprints match.
4. **Every change is versioned** — playbooks and patches are append-only with rollback.

## What Rote is not

- **Not a workflow engine** — humans never author playbooks; agents discover them.
  (But playbooks should *export* to human-readable YAML precisely so humans can audit them.)
- **Not semantic memory** — Rote stores procedures, not facts. Pair it with Mem0/Zep if
  you want both; they inject knowledge, Rote removes work.
- **Not compression** — pair with compression middleware at the LLM API boundary; orthogonal layers.

Next: [03 — Wedge Benchmark](03-wedge-benchmark.md)
