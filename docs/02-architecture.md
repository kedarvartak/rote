# 02 — Architecture

![Architecture](diagrams/architecture.svg)

## Design thesis

> **Control flow should be deterministic. The model's job is content and repair, not
> navigation.**

A successful run tangles two things together: *what to do* (the procedure) and *what to
say/fill/decide* (the content). Rote untangles them. The procedure becomes a
deterministic, replayable artifact; the model is invoked only where genuine judgment
lives — binding parameters, filling slots, repairing broken steps.

Rote is a **complete browser-agent harness**, not middleware. Every optimization that
matters lives inside the loop — what the model sees, when it's called, which model, how
actions are grounded — and a layer at the tool boundary can advise but cannot restructure
the loop. Rote's tools are still exposed over MCP, so the same codebase can be *driven
by* another client; the harness and the layer are two entry points, not two products.

## Status: what is built

**Read this table before believing anything below it.** Design and reality are easy to
confuse in an architecture doc; this is the boundary.

| Subsystem | State |
|---|---|
| Core schemas, Expect DSL, templating, fingerprinting | **built** |
| Recorder — append-only, crash-safe, fsync-per-event | **built** |
| Replay executor — verified, zero-model on hand-written playbooks | **built** |
| CDP browser backend, perception (distill → stable IDs → diff → budget) | **built** |
| Agent loop, context assembler, tagged LLM client | **built** |
| Benchmark matrix, per-source accounting, head-to-head gate | **built** |
| Action plane: settledness, resolution chain, optional expect + scoped repair | **built** — [T1](testing/T1-openai-dry-run.md)'s expect defect fixed (#49/#50) |
| **Playbook distiller** (trajectory → playbook) | **not built** — V1 playbooks are hand-written |
| **Matcher** (semantic match + bind) | **not built** — fingerprint gate only |
| **Site memory, model routing, speculation** | **not built** — designed below |

Packages that exist: `core recorder executor bench cli browser perception action agent llm`.
Designed but absent: `decision predictor memory mcp-server`.

## The four planes

| Plane | Baseline cost | Rote's answer | Status |
|---|---|---|---|
| **Perception** | 5–40K tokens/step, re-sent every step | distill → filter → diff → budget | built |
| **Decision** | frontier model, every step, full context | cache-local layout; route down or skip the model | layout built; routing designed |
| **Action** | act → wait → observe, serialized | settledness, self-healing resolution, speculation | first two built |
| **Learning** | every run starts cold | recorded trajectories → playbooks → site memory | recording + replay built |

## The control loop

```ts
async function runTask(task: TaskSpec, deps: HarnessDeps): Promise<TaskResult> {
  const fp = await fingerprint(deps.session);          // invariant 3: hard gate
  const brief = deps.memory.brief(fp, task);           // site memory, ≤1K tokens  [planned]
  const ctx = ContextAssembler.init({ task, brief });  // owns cache layout

  const match = deps.memory.matchPlaybook(fp, task);   // [planned]
  if (match?.confidence >= TAU_REPLAY)
    return deps.executor.replay(match, task.params);   // zero model steps  [built]

  while (true) {
    await deps.action.settled(deps.session);                            // built
    const obs = await deps.perception.observe(deps.session, ctx.budget); // built
    ctx.push(obs);                                                       // diff-encoded

    const route  = deps.decision.route(ctx, deps.memory);   // [planned] → frontier today
    const action = await deps.decision.decide(route, ctx);  // structured output, built

    const outcome = await deps.action.dispatch(action, deps.session);   // built
    deps.recorder.record(outcome);                                      // always
    if (outcome.expect.some(failed)) {
      const recovered = await deps.recovery.ladder(outcome, ctx);       // [partial]
      if (!recovered) return failCleanly(outcome);                      // invariant 2
    }
    if (action.verb === 'done')
      return deps.verify.gate(task, ctx)   // invariant 1: no verify pass, no success
        ? success(action.result)
        : deps.recovery.escalate(task, ctx);
  }
}
```

**The ContextAssembler owns message layout** and is the only module allowed to reorder
them: immutable system prompt + tool schemas → session-stable site brief → compacted
history → live tail. Prompt-cache reads are ~10× cheaper and agent loops re-send the
whole transcript every step, so **hit rate ≈ spend**. Tests fail if any volatile token
(timestamp, run id) lands above the stable line.

## Type spine (Zod-first; types derived, never hand-written)

```ts
// perception
interface StableNodeId { hash: string }        // role + name + ancestry content hash
type Observation =
  | { kind: 'full';    page: PageIdentity; tree: DistilledNode[]; tokens: number }
  | { kind: 'diff';    page: PageIdentity; baseSeq: number; changes: NodeChange[] }
  | { kind: 'summary'; page: PageIdentity; text: string; expandable: Region[] };

// decision
type StepClass = 'replay' | 'speculated' | 'grounded-routine' | 'frontier' | 'recovery';

// action — a small closed verb set, not 50 overlapping tools
type Action =
  | { verb: 'navigate'; url: string }
  | { verb: 'click';  target: StableNodeId }
  | { verb: 'fill';   target: StableNodeId; value: string }
  | { verb: 'select'; target: StableNodeId; option: string }
  | { verb: 'extract'; query: ExtractQuery }
  | { verb: 'done'; result: unknown } | { verb: 'fail'; reason: string };

interface StepOutcome {
  action: Action; result: ToolResult;
  expect: ExpectVerdict[];
  timing: { settleMs: number; actMs: number; observeMs: number; thinkMs: number };
  tokens: PerSourceTokens;          // invariant 5: every call tagged
}
```

**Stable IDs are a schema-level commitment.** They appear in trajectories, playbooks, and
memory, which is what makes diffs (`"#e42 changed"` rather than re-listing the page) and
cross-run learning possible at all. Most harnesses renumber every step and silently break
history reuse.

## Playbooks

A playbook is a parameterized step DAG. Humans never author them — agents discover them —
but they export to readable YAML precisely so humans can audit them.

```yaml
playbook: submit-vendor-invoice
version: 3                       # patches bump versions; history kept
task_signature:
  env_fingerprint: {domain: vendors.acme.com, tools: [browser.*]}
params:
  - {name: invoice_id, type: string}
steps:
  - id: open_portal
    tool: browser.navigate
    args: {url: "https://vendors.acme.com/invoices"}
    expect: {selector_visible: "#invoice-table"}
    on_fail: repair              # repair | retry(n) | fallback
  - id: fill_amount
    tool: browser.fill
    args: {selector: "#amount", value: "{{amount}}"}     # slot
    expect: {input_value: "#amount", equals: "{{amount}}"}
verify:
  - {text_visible: "Invoice submitted"}
confidence: 0.94                 # updated every run
```

Three step kinds, deliberately minimal:

- **Deterministic** — tool + bound args. Zero model tokens.
- **Slot** — the model fills a value. Small, scoped, cheap-model-eligible.
- **Judgment gate** — a rare explicit branch, encoded as constrained classification, not
  free-form planning.

## Verification, and what T1 taught us

Every step carries a postcondition; the task carries a final `verify[]`. **Success is
only reported if verification passes** — invariant 1, and the anchor under every
efficiency claim (all benchmark numbers are *at success parity*).

[T1](testing/T1-openai-dry-run.md) found the live-agent version of this was
mis-designed: the action schema made `expect` **mandatory**, so the planner had to
predict the page's confirmation text before seeing it. It guessed plausibly and wrongly,
and correct runs were recorded as failures (B2: 0/7). Meanwhile the expects that *passed*
were largely tautological — asserting a value the model itself had just typed.

The lesson generalizes: **a model-authored postcondition about a future state is either a
guess or a tautology.** T1's B2 sharpened it further — the confirmation section is
`hidden` until submit and the distiller drops hidden nodes, so the post-click state was
not expressible in *any* primitive of the DSL. Text or selector alike, the model had
never seen it. Steering toward "structural" expects would only have moved the guess from
a string to an id.

**Resolved ([#49](https://github.com/kedarvartak/rote/issues/49),
[#50](https://github.com/kedarvartak/rote/issues/50)) — `expect` is now optional:**

1. The planner is told to **omit** rather than guess, and does: across live re-runs it
   omitted on every action of B1/B3/B2, so the tautologies disappeared too. Forcing the
   field was itself the cause of both failure shapes — a mandatory slot with nothing true
   to put in gets filled with an invention or a restatement.
2. A failed expect is no longer fatal. It buys **one scoped repair** (rung 2 below),
   because a failed assertion means the model's belief was wrong, not that the action
   was — on B2 the submit had already landed. Exhausting the budget is fatal.
3. Success still requires the independent final `verify` gate, authored against ground
   truth. That gate is what makes B1/B3/B2 successes real, and it never moved.

Result: B2 0/7 → **11/11** on `gpt-5.6-luna` and `gpt-5.6-sol`, at roughly neutral token
cost (B3 got ~1% *cheaper* — the output tokens saved by not emitting `expect` paid for
the prompt guidance). Deriving postconditions from the observation diff instead of
asking the model at all remains open as [#54](https://github.com/kedarvartak/rote/issues/54).

## Repair ladder

![Repair ladder](diagrams/repair-ladder.svg)

On assertion failure — never fail the task blindly, never silently continue:

1. **Retry** — transient (network, timing), per step policy.
2. **Scoped repair** — a model call with *narrow* context: the failing step, its expected
   postcondition, observed state, and the step's intent. It re-derives one step, emits a
   **patch**, replay resumes. Patches are additive and versioned; bad patches roll back,
   and patch history is itself a drift signal.
3. **Fallback** — full agent run, recorded, re-learned. Worst case equals not having Rote.

Cheap recovery is an efficiency feature: a scoped repair costs ~one step; a blind restart
costs the whole task.

## Learning plane (designed)

Three memory tiers, in build order:

| Tier | Content | Mode |
|---|---|---|
| 1 — **Playbook** | whole-task DAG, exact repeats | replay (contract: verified, zero-model) |
| 2 — **Subflow** | shared prefixes (login → dashboard) reused across tasks | replay with hand-off |
| 3 — **Site memory** | selector maps, form semantics, page graph, settle times, quirks | **advisory** — the agent stays in control |

The distinction matters: tiers 1–2 *execute*; tier 3 only *informs* (a ≤1K-token brief,
resolution hints, calibrated settle times). Advisory memory can be wrong without being
dangerous — the agent still observes and verifies.

## Speculative execution (designed)

The loop is fully serialized: think → act → settle → observe → think. **While the model
thinks about step N, the predicted step N+1 can already be executing** in a shadow
context — promote on hit, discard on miss, never past the effect boundary. This needs an
action safety classifier (`pure-read` / `local-nav` / `local-write` / `external-effect`),
a session virtualizer, and a predictor over recorded runs. Research with blind draft
models reaches ~55% accuracy for ~20% latency; trajectory memory should predict warm
sites far better. Kill gate: ≥70% top-1 accuracy offline, before any systems work.

## Run economics

![Run lifecycle](diagrams/run-lifecycle.svg)

| | Cold (run 1) | Warm (run N) | Drift (run N+k) |
|---|---|---|---|
| Model in control loop | every step | never | one step |
| Tool calls | ~40 (incl. dead ends) | ~6 (essential only) | ~8 |
| Artifact | trajectory → playbook v1 | confidence++ | patch → v2 |

Illustrative, not measured — the measured numbers live in [03](03-benchmark.md) and
[testing/](testing/). The marginal cost of a memoized task trends toward the
**verification floor**: the price of proving the replay still holds. That floor is the
honest lower bound. You never reach zero, because trusting an unverified replay is how
you ship wrong answers.

## Invariants

1. **Never silently wrong** — every replayed step is assertion-gated; no path reports
   success on a failed check.
2. **Never worse than baseline** — full-agent fallback always reachable, and it logs
   *why* it fired.
3. **Never cross environments** — structural fingerprint is a hard gate. A playbook
   learned on staging cannot fire on prod.
4. **Everything versioned** — playbooks and patches are append-only, with rollback.
5. **Every model call is tagged** — `planner|matcher|slot|repair|verify|distill`, through
   one client wrapper. Untagged calls fail lint.

These bind the agent loop exactly as they bound the middleware design. They are not
negotiable under schedule pressure; see `CLAUDE.md`.

## What Rote is not

- **Not a workflow engine** — humans never author playbooks; agents discover them.
- **Not semantic memory** — Rote stores procedures, not facts. Pair with Mem0/Zep:
  they inject knowledge, Rote removes work.
- **Not compression** — orthogonal. Compression shrinks a step; Rote declines to run it.

Next: [03 — Benchmark](03-benchmark.md)
