<div align="center"><pre>
██████╗  ██████╗ ████████╗███████╗
██╔══██╗██╔═══██╗╚══██╔══╝██╔════╝
██████╔╝██║   ██║   ██║   █████╗
██╔══██╗██║   ██║   ██║   ██╔══╝
██║  ██║╚██████╔╝   ██║   ███████╗
╚═╝  ╚═╝ ╚═════╝    ╚═╝   ╚══════╝
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

Rote is harness middleware that sits at the **tool-call boundary** (not the LLM API boundary,
so it composes with compression proxies at that boundary rather than competing):

1. **Record** — taps every tool call during a normal run. Always-on, cheap, no LLM.
2. **Distill** — an offline LLM pass turns a *successful* trajectory into a **playbook**: a
   parameterized step DAG with per-step assertions and typed content slots. Dead-end
   exploration is pruned; task inputs become parameters.
3. **Replay** — on the next matching task, Rote executes the playbook deterministically. The
   LLM planner is out of the control loop; it's invoked only to fill content slots.
4. **Self-heal** — when the world drifts (a selector moved, a flag renamed), the failing step
   is repaired in isolation and saved as a versioned patch — never a full re-exploration.

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

**Early build — M0–M2 done.** Data model, the MCP recorder, and the replay executor are
built and tested against fake-world fixtures. Next up is M3, the benchmark harness — the
kill-or-continue gate: prove ≥80% token reduction at success parity on a real task suite,
or the thesis dies for the price of a few weeks' work. See
[the build plan](docs/06-build-plan.md) for milestone-by-milestone detail.

## Docs

| Doc | Contents |
|---|---|
| [Problem](docs/01-problem.md) | The reuse-path gap and why incumbents don't fill it |
| [Architecture](docs/02-architecture.md) | Components, playbook spec, failure-safety invariants |
| [Wedge benchmark](docs/03-wedge-benchmark.md) | "Run it twice" — task suite, metrics, kill thresholds |
| [Market](docs/04-market.md) | Competitive map, steelmanned objections, buyers, why now |
| [Roadmap](docs/05-roadmap.md) | Phased plan and open questions |
| [Build plan](docs/06-build-plan.md) | Milestone-by-milestone execution detail: tasks, test suites, exit/kill gates |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev workflow and PR conventions,
and [CLAUDE.md](CLAUDE.md) for the full engineering ruleset. Please also read
our [Code of Conduct](CODE_OF_CONDUCT.md). Found a security issue? See
[SECURITY.md](SECURITY.md) — please don't file it as a public issue.

## License

MIT — see [LICENSE](LICENSE).
