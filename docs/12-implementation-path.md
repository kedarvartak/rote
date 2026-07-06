# 12 — Implementation Path: From the Current Code to Speculative Execution

> Status: design. Companion to [11 — Speculative Execution](11-speculative-execution.md):
> what we already have, what it becomes, and in what order. Milestones here supersede
> doc 06's M4–M7 ordering; M0–M3 are history (built). Doc 06 remains the reference for
> the M0–M3 gates and for the testing discipline every milestone below inherits.

## Inventory: what exists today and what it becomes

| Existing code | Today's job | Job in the doc-11 design |
|---|---|---|
| `@rote/core` schemas (`TrajectoryEvent`, `RunManifest`, `EnvFingerprint`, `Playbook`, `Patch`, Expect DSL) | Data model for record/replay | Unchanged foundation. Trajectories are the **predictor's training data**; the Expect DSL doubles as the **speculation commit gate**'s assertion language |
| `@rote/core` `template.ts` (param extraction/rendering) | Playbook `{{param}}` binding | Reused verbatim for **arg normalization** in trace matching — a recorded `fill(#name, "Acme")` predicts today's `fill(#name, "Globex")` because both normalize to the same template |
| `@rote/core` `fingerprint.ts` | Env fingerprint hash | The predictor's hard gate: predictions never cross fingerprints (invariant 3 applies to speculation exactly as to replay) |
| `@rote/recorder` `proxy.ts` + `jsonrpc.ts` | stdio MCP tee: forward unmodified, record `tools/call` round-trips | Splits in two (see refactor below): a generic **proxy relay with a middleware chain**, and the recorder as its first middleware. The speculator becomes the second |
| `@rote/recorder` `sequential-queue.ts`, `trajectory-writer.ts`, `blob-store.ts`, `manifest-writer.ts` | Crash-safe append-only recording | Unchanged. Speculation outcomes (`SpeculationRecord`) become one more event kind flowing through the same writer |
| `@rote/executor` `expect-evaluator.ts` + `world-state.ts` | Assertion checks during replay | Reused as-is by the speculation **hit test**: post-state landmark checks on speculated executions are Expect DSL evaluations against a WorldState built from the shadow's observation |
| `@rote/executor` `tool-caller.ts` interface + `mcp-tool-caller.ts` | Executor's tool boundary | Reused by the speculator to drive shadow contexts — a shadow is just another `ToolCaller` |
| `@rote/executor` `executor.ts` | Deterministic playbook replay | Untouched. Replay is the limiting case of speculation (depth = whole flow, doc 11); it stays the top gear |
| `@rote/executor` `llm-client.ts` wrapper | Tagged LLM calls | Gains a `predict` source tag for the optional draft-LLM predictor. **CLAUDE.md invariant 5's tag list and `TokenUsageSourceSchema` must be extended in the same PR** — a stale ruleset is a bug, like a stale doc |
| `@rote/bench` matrix runner + report | Token/cost accounting per `{task × phase × repetition}` | Gains wall-clock columns (p50/p95 per step, units: ms), speculation counters (hit/miss/wasted), and a **simulation mode** (below) |
| `@rote/cli` | `rote runs ls/show` | Gains `rote simulate` (offline predictor evaluation over stored runs) and `rote spec report` |
| `fixtures/` fake-world playbooks + fake MCP downstream | Deterministic tests | The fake downstream gains **configurable per-call latencies** so latency benchmarks are deterministic in CI |

Net: the recorder, executor, and core survive intact; nothing built so far is discarded.
The genuinely new code is the predictor (pure logic), the session virtualizer, the
speculator middleware, and the observation differ.

## The one refactor: extract the proxy relay

`@rote/recorder`'s proxy currently hard-wires one concern (recording) into the relay
loop. Doc 11 needs a second concern (speculation) in the same position, and CLAUDE.md's
modularity rule ("one module = one responsibility") says that means a split, not a
bigger recorder:

```text
packages/proxy      relay core: stdio transport, JSON-RPC framing, ordering,
                    passthrough-on-failure, and a middleware chain:
                       interface ProxyMiddleware {
                         onCall?(call, next): Promise<Result>;   // may answer instead of forwarding
                         onResult?(call, result): void;          // observe-only
                       }
packages/recorder   becomes middleware #1 (observe-only tap) — behavior identical,
                    its 36 tests move with it and must pass unchanged
packages/speculator becomes middleware #2 (may answer calls from speculated results)
packages/predictor  pure logic: trace matching, transition model, calibration
```

Dependency direction stays legal: `proxy` and `predictor` depend only on `core`;
`speculator` depends on `core`, `proxy`, `predictor`, and `executor`'s exported
evaluator; `cli` on all. No cycles.

## New core schemas (Zod first, types derived — never hand-written interfaces)

- `NormalizedToolCallSchema` — tool name + arg template + bound params; the unit of
  prediction and of hit-testing.
- `SafetyClassSchema` — closed enum `pure-read | local-nav | local-write | effectful`
  plus the evidence records that justify a reclassification (append-only, invariant 4).
- `SpeculationRecordSchema` — one per speculation attempt: prediction, confidence,
  where executed, outcome (`hit | miss | abandoned`), latency saved/wasted (ms). Written
  into the trajectory so benchmarks and calibration read one data source.
- `TransitionModelSchema` — per-fingerprint counts `(context-hash → call-template)`,
  versioned snapshots, never edited in place.

## Milestones

Each follows doc 06's discipline: fake-world tests first, sacred-invariant additions for
any executor/matcher/store-adjacent change, exit gates that can kill.

### M4 — Predictor + offline simulation (the kill gate; ~1 week)

Pure logic only — no proxy changes, no live browser.

- Build `packages/predictor`: trace matching over stored trajectories (suffix alignment
  + arg templating), confidence scoring; transition model builder as a pure function
  over a set of trajectories.
- Build simulation into `@rote/bench`: replay every recorded trajectory prefix-by-prefix,
  score next-call prediction, and compute the *projected* latency overlap from recorded
  per-call timings.
- `rote simulate --runs <dir>` prints accuracy and projected overlap per fingerprint.
- Tests: property-based (predictions are deterministic given (context, memory); never
  cross fingerprints), golden tests on fake-world trajectories.
- **Exit gate (kill): top-1 next-call accuracy ≥ 70% on warm fake-world trajectories
  and ≥ 60% on our own recorded real-site runs.** Below that, speculation dies for the
  price of one package and doc 11 gets rewritten honestly.

### M5 — Proxy refactor + session virtualizer (~1 week)

- Extract `packages/proxy` with the middleware chain; recorder becomes middleware #1.
  Gate: recorder's existing test suite passes unmoved; proxy overhead benchmark (doc 06
  M1) re-run and within budget.
- Session virtualizer: virtual-session handle, live-context routing, shadow create
  (storage-state clone) / dispose / promote as operations with tests against the fake
  downstream. No speculation yet — shadows are created and promoted only in tests.
- Sacred invariant addition: promotion is atomic — no interleaving where the agent's
  call executes half on the old context, half on the new.

### M6 — Prefetch speculation, `pure-read` only (~1 week)

The smallest real win, in the live session, no shadows in the hot path:

- Speculator middleware, depth 1, `pure-read` predictions only (pre-fetch the
  observation the agent is about to ask for).
- Hit test: exact normalized match + freshness (no interleaved call since prefetch).
- Latency-configurable fake downstream lands here; bench gains wall-clock columns.
- **Exit gate: on fake-world warm flows, p50 step latency reduction ≥ 15% at zero
  correctness change (byte-identical results vs passthrough), misprediction overhead
  ≤ 3% wall-clock on cold flows.**

### M7 — Observation differ (~1 week)

- Snapshot store per virtual session; diff encoding + `full_available` escape hatch;
  size-ratio guard (diff > 60% of full ⇒ serve full).
- Off by default per session; adopter prompt-snippet shipped in the package README.
- **Exit gate: ≥ 50% observation-token reduction on warm fake-world flows at task
  success parity in the live harness smoke test.**

### M8 — Shadow speculation + promotion (`local-nav`/`local-write`) (~1.5 weeks)

The full doc-11 pipeline at depth 1:

- Safety classifier with conservative defaults + evidence-based reclassification store.
- Clone → execute → expect-check → (promote | dispose); divergence invalidation;
  domain rate caps.
- Sacred invariants: never serve on any failed check; never speculate `effectful`;
  effect boundary enforced by construction (classifier returns the fence).
- **Exit gate: on the fake-world suite with injected think-time, end-to-end wall-clock
  reduction ≥ 30% warm at success parity; zero speculated server-mutating calls across
  the whole adversarial test set (a test suite that *tries* to trick the classifier).**

### M9 — Depth > 1 + calibration (~1 week)

- Pipeline depth on high-confidence trace matches, fenced at `effectful`; per-site τ
  calibration from `SpeculationRecord` history; auto-quiesce on hit-rate collapse.
- **Exit gate: the doc 03/09 benchmark extended with latency — warm flows
  think-time-bound (act+observe ≤ 10% of step time), plus the doc 09 token gates.**

Doc 06's original M4 (matcher) and M5 (distiller) fold in rather than disappear: the
distiller's first shippable output becomes the transition model (needed from M4 here),
and the task-level matcher is only needed when full replay re-enters the critical path
after M9. M6 (repair) is unchanged and still gates replay, not speculation — a
speculation "failure" is just a miss, which needs no repairing.

## Sequencing rationale

Cheapest falsification first: M4 kills the thesis with zero systems work if the
predictor can't predict. Every subsequent milestone ships a standalone win (M6 prefetch
and M7 diffs pay for themselves even if shadows never land) and the riskiest machinery
(shadow promotion) comes last, after the proxy, virtualizer, and hit-test code paths
have soaked under the milder modes. The safety story never regresses: each milestone
widens what may be speculated only after the previous mode's invariant suite is green.
