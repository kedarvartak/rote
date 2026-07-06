<div align="center"><pre>
 ____        _       
|  _ \ ___  | |_ ___ 
| |_) / _ \ | __/ _ \
|  _ < (_) || ||  __/
|_| \_\___/  \__\___|
</pre>

**Trajectory memoization for agent harnesses.**
Your agent solved this yesterday. Stop paying for it to figure it out again.

</div>

---

## The one-liner

> **Compression makes every token cheaper. Rote makes most tokens not exist.**

Compression is the *read path*. Semantic memory (Mem0, Zep, Letta) is the *write path*.
**Rote owns the reuse path** — it captures *how* an agent solved a task, then replays that
procedure deterministically instead of re-deriving it from scratch every run.

## The problem

Watch any coding / browser / ops agent run the same class of task twice:

- **Run 1** — 40 tool calls, ~200K tokens spent discovering how to run the tests, where the
  config lives, which selectors matter, what the deploy sequence is. It succeeds.
- **Run 2** (fresh context, next day) — **the entire thing again, from zero.** Same greps,
  same dead ends, same tokens, same wall-clock.

The harness threw away the single most valuable thing it produced: the **procedure**.
Agents have episodic amnesia — not about *facts* (semantic memory handles those), but about
**skills**. That re-derivation is the biggest hidden cost in production agent fleets, and no
dashboard measures it.

## What Rote does

Rote is an **efficiency-first browser-agent system**: a complete harness whose
architecture is built around spending the fewest tokens and the least wall-clock per
task at success parity — with a second entry point that exposes the same machinery
over MCP so other agents can use it as a layer (see
[docs/13](docs/13-agent-system.md)). Its core moves:

1. **Record** — taps every tool call during a normal run. Always-on, cheap, no LLM.
2. **Distill** — an offline LLM pass turns a *successful* trajectory into a **playbook**: a
   parameterized step DAG with per-step assertions and typed content slots. Dead-end
   exploration is pruned; task inputs become parameters.
3. **Replay** — on the next matching task, Rote executes the playbook deterministically. The
   LLM planner is out of the control loop; it's invoked only to fill content slots.
4. **Self-heal** — when the world drifts (a selector moved, a flag renamed), the failing step
   is repaired in isolation and saved as a versioned patch — never a full re-exploration.
5. **Speculate** — even when no full playbook matches, recorded experience predicts the
   agent's next action, and Rote executes it *while the model is still thinking* — a correct
   prediction collapses the step to a confirmation; a wrong one is discarded losslessly.
   See [docs/11](docs/11-speculative-execution.md).

```
Cold (run 1) ──▶ Warm (run N) ──▶ Drift (run N+k)
  ~40 calls        ~6 calls          ~8 calls
  ~210K tok        ~18K tok (-91%)   ~31K tok (-85%)
  LLM every step   LLM never         LLM one step
```

![Architecture](docs/diagrams/architecture.svg)

## Design invariants

1. **Never silently wrong** — every replayed step is assertion-gated; a final verify block
   must pass or the run escalates the repair ladder.
2. **Never worse than baseline** — full-agent fallback always exists. A Rote miss costs one
   cheap match call.
3. **Never cross environments** — a structural fingerprint (tool inventory, target-system
   identity) is a hard gate. A playbook learned on staging can't fire on prod.
4. **Everything versioned** — playbooks and repair patches are append-only, auditable,
   diffable, and exportable as human-readable YAML.

## Why "Rote"

*Rote*: doing something from memory, by repetition, without re-deriving it. That's the whole
thesis in one word — and it's memoization (caching an expensive computation keyed by inputs)
applied to agent trajectories, with assertions + scoped repair in place of TTL invalidation.

## Status

**Early build — M0–M3 done, direction set on the full agent system.** Data model, the
MCP recorder, the replay executor, and the benchmark harness are built and tested
against fake-world fixtures. The direction of record is
[docs/13 — the Rote agent system](docs/13-agent-system.md): a complete
efficiency-first browser-agent harness, built by the H1–H8 plan in
[docs/16](docs/16-harness-architecture.md), with every optimization inventoried in
[docs/14](docs/14-optimization-catalog.md).

## Docs

| Doc | Contents |
|---|---|
| [Problem](docs/01-problem.md) | The reuse-path gap and why incumbents don't fill it |
| [Architecture](docs/02-architecture.md) | Components, playbook spec, failure-safety invariants |
| [Wedge benchmark](docs/03-wedge-benchmark.md) | "Run it twice" — task suite, metrics, kill thresholds |
| [Market](docs/04-market.md) | Competitive map, steelmanned objections, buyers, why now |
| [Roadmap](docs/05-roadmap.md) | Phased plan and open questions |
| [Build plan](docs/06-build-plan.md) | Milestone-by-milestone execution detail: tasks, test suites, exit/kill gates |
| [Where Rote works](docs/07-where-rote-works.md) | Browser-agent fit guide: where site memory and replay help or do not help |
| [Browser memory architecture](docs/08-browser-memory-architecture.md) | Memory tiers, replay vs advisory modes, build order |
| [Generalization evaluation](docs/09-generalization-evaluation.md) | How the memory tiers get benchmarked beyond exact repeats |
| [Competitive landscape](docs/10-competitive-landscape.md) | Who memoizes browser agents today and where the gaps are |
| [Speculative execution](docs/11-speculative-execution.md) | Overlapping model thinking with browser acting — memory as a branch predictor |
| [Implementation path](docs/12-implementation-path.md) | How the existing packages evolve into the speculative pipeline |
| [The Rote agent system](docs/13-agent-system.md) | Direction of record: a full efficiency-first browser-agent system |
| [Optimization catalog](docs/14-optimization-catalog.md) | Every optimization the system needs — evidence, incumbents, priorities |
| [Competitor teardown](docs/15-competitor-teardown.md) | The 2026 field, per player, with a capability matrix |
| [Harness architecture](docs/16-harness-architecture.md) | Components, interfaces, control loop, and build order |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev workflow and PR conventions,
and [CLAUDE.md](CLAUDE.md) for the full engineering ruleset. Please also read
our [Code of Conduct](CODE_OF_CONDUCT.md). Found a security issue? See
[SECURITY.md](SECURITY.md) — please don't file it as a public issue.

## License

MIT — see [LICENSE](LICENSE).
