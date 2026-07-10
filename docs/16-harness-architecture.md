# 16 — Harness Architecture: The Rote Agent System in Detail

> Status: design. The technical companion to [13](13-agent-system.md): components,
> interfaces, the control loop, package layout, and build order. Optimization IDs
> (A4, C3, …) refer to [14 — Optimization Catalog](14-optimization-catalog.md).
> Everything here obeys the CLAUDE.md invariants and modularity rules; existing
> packages carry over per [12 — Implementation Path](12-implementation-path.md), which
> this doc extends from "middleware pipeline" to "full harness".

## Package layout (target)

![Current and target package topology](diagrams/package-map.svg)

The upper half is the implemented repository. The lower half is the planned composition;
dashed borders are not yet shipped packages.

```text
packages/core        schemas + pure logic (exists; grows: Action, Observation,
                     StableNodeId, Prediction, SafetyClass, SessionState — Zod-first)
packages/browser     CDP session backend(s): launch/connect/clone/dispose, input,
                     navigation, network + mutation instrumentation   [E1, E2]
packages/perception  distiller → stable IDs → filter → differ → budgeted renderer
                     + elective vision/SoM + WebMCP source            [A1–A10]
packages/decision    context assembler (cache-layout-aware), model router,
                     prompt construction, structured action decoding  [B1–B6]
packages/action      settledness, element resolution, dispatch, expect checks,
                     shadow contexts + speculation commit             [C1–C6]
packages/predictor   trace matching, transition models, calibration   [D4]  (doc 12 M4)
packages/memory      site memory store, playbook store, distiller     [D2, D3, D5]
packages/executor    verified replay (exists, unchanged)              [B2, F1]
packages/recorder    lossless trajectory recording (exists; records the harness's
                     own loop now, not just proxied traffic)          [D1]
packages/agent       the control loop that composes all of the above; task API;
                     recovery ladder                                  [F2]
packages/llm         shared source-tagged provider boundary used by every plane
                     that makes model calls                            [B5, G1]
packages/bench       benchmark matrix + latency + competitor harness adapters
                     (exists; grows)                                  [F4, G1, G2]
packages/cli         rote run / serve / runs / simulate / report
packages/mcp-server  Rote's tools exposed over MCP (the harness as a layer for
                     other agents — the doc 13 dual entry point)
```

Dependency direction: everything → `core`; model-calling packages → `llm`; `agent`
composes; `cli`/`mcp-server` on top. `perception`, `decision`, `action` stay pure at their centers (rendering,
routing policy, resolution ranking are dependency-free functions) with I/O at the edges.

## Core type spine (Zod-first, abbreviated)

```ts
// perception
interface StableNodeId { hash: string }               // role+name+ancestry content hash [A3]
interface DistilledNode { id: StableNodeId; role: Role; name: string;
  state?: NodeState; rect?: Rect; children?: DistilledNode[] }
type Observation =
  | { kind: 'full';  page: PageIdentity; tree: DistilledNode[]; tokens: number }
  | { kind: 'diff';  page: PageIdentity; baseSeq: number;
      changes: NodeChange[]; landmarks: StableNodeId[]; tokens: number }   // [A4]
  | { kind: 'summary'; page: PageIdentity; text: string;
      expandable: Region[]; tokens: number }                               // [A8 degrade]

// decision
type StepClass = 'replay' | 'speculated' | 'grounded-routine' | 'frontier' | 'recovery';
interface RouteDecision { class: StepClass; model?: ModelId; reason: string } // [B1]

// action
type Action =                                                             // [C4]
  | { verb: 'navigate'; url: string } | { verb: 'click'; target: StableNodeId }
  | { verb: 'fill'; target: StableNodeId; value: string }
  | { verb: 'fill_form'; entries: Array<{target: StableNodeId; value: string}> } // [C5]
  | { verb: 'select'; target: StableNodeId; option: string }
  | { verb: 'press'; key: KeyChord } | { verb: 'scroll'; to: ScrollTarget }
  | { verb: 'extract'; query: ExtractQuery } | { verb: 'read_more'; region: Region }
  | { verb: 'wait'; until: SettleCondition } | { verb: 'done'; result: unknown }
  | { verb: 'fail'; reason: string };

interface StepOutcome { action: Action; result: ToolResult;
  expect: ExpectVerdict[];          // [C6] — evaluated even in live-agent mode
  timing: { settleMs: number; actMs: number; observeMs: number; thinkMs: number };
  tokens: PerSourceTokens }         // [G1]
```

## The control loop (packages/agent), annotated

```ts
async function runTask(task: TaskSpec, deps: HarnessDeps): Promise<TaskResult> {
  const fp = await fingerprint(deps.session);                    // invariant 3 gate
  const brief = deps.memory.brief(fp, task);                     // [D3] ≤1K tokens
  const ctx = ContextAssembler.init({ task, brief });            // [B3] layout owner

  // fast path: whole-task replay
  const match = deps.memory.matchPlaybook(fp, task);
  if (match?.confidence >= TAU_REPLAY)
    return deps.executor.replay(match, task.params);             // [B2] built, M2

  while (true) {
    await deps.action.settled(deps.session);                     // [C1]
    const obs = await deps.perception.observe(deps.session, ctx.budget); // [A1–A8]
    ctx.push(obs);                                               // differ ensures diff-encoding

    // speculation may have already produced the next step during the previous think
    const spec = deps.action.takeSpeculationHit(ctx.lastIntent); // [C3] doc 11 hit test
    if (spec) { ctx.commit(spec); continue; }

    const route = deps.decision.route(ctx, deps.memory);         // [B1]
    const action = await deps.decision.decide(route, ctx);       // structured output [B5]

    // fire speculation for N+1 while WE dispatch N (and the next think overlaps)
    deps.action.speculate(deps.predictor.predict(ctx), deps.session); // [C3][D4]

    const outcome = await deps.action.dispatch(action, deps.session); // [C2][C4][C6]
    deps.recorder.record(outcome);                               // [D1] always
    if (outcome.expect.some(failed)) {
      const recovered = await deps.recovery.ladder(outcome, ctx);// [F2]
      if (!recovered) return failCleanly(outcome);               // invariant 2
    }
    if (action.verb === 'done')
      return deps.verify.gate(task, ctx)                         // [F1] invariant 1:
        ? success(action.result)                                 // no verify pass →
        : deps.recovery.escalate(task, ctx);                     // no success report
  }
}
```

Notes the pseudocode compresses:

- **ContextAssembler owns layout** [B3]: system prompt + tool schemas (immutable) →
  site brief (session-stable) → compacted history → live tail. It is the only module
  allowed to mutate message order, and it carries tests that fail if any volatile
  token (time, run id) lands above the stable line. Compaction [B4] runs *inside* it,
  scheduled by cache economics (tombstone superseded observations near the tail;
  never rewrite deep prefix mid-session).
- **Speculation placement**: predict-and-pre-execute fires right after each decision,
  so shadow work overlaps both our dispatch and the model's next think — the doc 11
  pipeline, embedded in the loop rather than a proxy. Effect boundary and promotion
  semantics are doc 11 §2–3 verbatim.
- **Live-agent expect checks** [C6]: when memory knows a transition's postcondition,
  the agent's own actions get gated too — drift is caught at the step, in either mode.
- **Recovery ladder** [F2]: retry → scoped repair (frontier model, narrow context:
  failing step + expectation + observed state) → task-level fallback (fresh frontier
  run, recorded → re-distilled). Each rung tagged and accounted.

## Perception pipeline (packages/perception)

![Perception pipeline](diagrams/perception-pipeline.svg)

WebMCP, when present, becomes a higher-priority structured source before browser capture.
Filtering and diffing operate on the distilled snapshot; selective vision is an on-demand
escalation rather than the default observation path.

Pure center: `distill`, `diffTrees`, `render` are dependency-free functions over
captured data (property-tested: diff+base reconstructs full; render never exceeds
budget; IDs stable under attribute-only mutations). Capture and CDP live at the edge.
Re-observation is event-driven [A6]: the mutation/network instrumentation that feeds
settledness [C1] also invalidates snapshots — one instrumentation, two consumers.

## Decision plane details (packages/decision)

Routing policy [B1], first version deliberately dumb and measurable:

```text
if speculation hit pending            → class 'speculated'   (no model)
elif memory.nextActionConfidence ≥ τ₁ → class 'grounded-routine' → small model,
                                        memory prediction included as proposal [B6]
elif last step failed / verify failed → class 'recovery'     → frontier
else                                  → class 'frontier'
```

Escalation contract: a small-model decision that fails schema validation, targets an
unknown StableNodeId, or trips an expect check is retried once on frontier with the
failure attached — escalations are recorded, and per-site escalation rates feed τ₁
calibration. Model choice is config (`grounded: fara-7b | haiku-class`,
`frontier: sonnet/opus-class`); everything through the tagged LLM client (invariant 5;
tags gain `route` alongside `predict`).

## What changes for the existing packages

| Package | Change | Risk |
|---|---|---|
| `core` | +schemas above; Expect DSL untouched | Low — additive |
| `recorder` | Records the harness's own loop via the same writer; the MCP-proxy mode remains for the layer entry point | Low |
| `executor` | None (replay engine) — called by the loop's fast path | None |
| `bench` | +latency columns, +adapters to run Browser Use/Stagehand on the same fixtures for head-to-head numbers | Medium — adapter fidelity must be fair (doc 03's honesty rules apply to competitors too) |
| `cli` | `rote run "<task>" --site …` becomes the front door | Low |
| doc 12 milestones | M4 (predictor) and M5 (proxy refactor → now session backend + virtualizer) proceed as planned; M6+ re-scoped into the build order below | — |

## Build order (supersedes doc 12 M6+; M4–M5 stand)

Principle unchanged: cheapest falsification first, every milestone a standalone win,
invariant suites before width.

| Milestone | Scope | Exit gate |
|---|---|---|
| **H1** | `browser` (CDP local backend) + `perception` A1/A2/A3 + `agent` minimal loop (frontier-only, full observations) + recorder wired | Completes B1–B3 fixture tasks end-to-end; observation ≤ Browser Use token counts on same pages (parity gate) |
| **H2** | A4 diffs + A8 budgeter + B3 context assembler | ≥60% observation-token reduction on multi-step fixture flows at success parity; zero budget overruns; prefix-stability tests green |
| **H3** | C1 settledness + C2 resolution + C6 live expect checks | Flake rate < baseline harness on the drift fixture suite; every exit path in the sacred invariant suite |
| **H4** | Predictor (doc 12 M4, unchanged) + B1 routing with small model | Kill gate: ≥70% warm next-action accuracy; ≥50% of warm-flow steps off the frontier model at parity |
| **H5** | C3 speculation (doc 11/12 M8 semantics, in-loop) | ≥30% wall-clock reduction warm at parity; zero effect-boundary violations on the adversarial suite |
| **H6** | D2/D3 distiller + site memory serving (brief, resolution ranking, settle priors) | Doc 09 learning curve bends: T2 (novel-task-on-known-site) ≥30% token reduction |
| **H7** | Head-to-head public benchmark: Rote vs Browser Use vs Stagehand-agent vs CUA-class on the fixture suite + a live-site sample, tokens/latency/$ at success parity, raw JSONL published | The number is the launch. Kill honesty: if Rote doesn't clearly win cost-at-parity, we do not launch on efficiency claims |
| H8+ | A5/A6/A7/A9, C5, E3/E5, F3, G2 by measured ROI | Per-entry gates from doc 14 |

## Open questions (tracked, not hand-waved)

1. **Small-model hosting**: Fara-class models are self-hostable (7B) — bundled local
   inference vs API? Affects adoption friction vs cost story. Decide at H4 with data.
2. **Python story**: the ecosystem's community is Python-heavy (Browser Use). Formats
   are language-neutral (JSONL/YAML); a Python SDK wrapping the MCP entry point may be
   enough. Decide post-H7.
3. **Vision budget defaults** [A7]: what fraction of steps genuinely needs vision on
   the fixture suite? Measure in H3; set defaults from data, not taste.
4. **How much of doc 02's matcher survives** at the task level vs being subsumed by
   the router — revisit at H6 when playbook matching re-enters the hot path.
