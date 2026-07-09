<div align="center"><pre>
 ____        _       
|  _ \ ___  | |_ ___ 
| |_) / _ \ | __/ _ \
|  _ < (_) || ||  __/
|_| \_\___/  \__\___|
</pre>

**An efficiency-first browser-agent system.**
Fewer observation tokens, lower latency, and browser memory that compounds with every run.

</div>

---

## The one-liner

> **Rote is the browser agent that gets cheaper as it learns a site.**

Browser agents spend most of their budget repeatedly observing pages, grounding elements,
waiting for UI state, and rediscovering workflows. Rote treats efficiency as the harness
architecture: compact perception, cache-friendly context, verified replay, and a learning
plane that turns past runs into browser memory.

## The problem

A typical browser agent loop is expensive and serialized:

```text
observe page → model thinks → act → wait → observe again
```

On real portals, every observation can mean thousands of DOM/accessibility/screenshot
tokens. Across repeated use of the same sites, agents keep paying to rediscover:

- which fields and buttons matter
- which selectors are stable
- what confirms success or failure
- which navigation prefixes are common
- which observations changed and which stayed the same

Rote's goal is simple: **the more your browser agent uses a website, the less it should
need to explore that website from scratch.**

## What Rote does

Rote is a complete browser-agent harness with four efficiency planes (see
[docs/13](docs/13-agent-system.md)):

1. **Perception** — capture pages through CDP, distill them into compact interactive trees,
   assign stable element IDs, and send diffs instead of full page dumps when possible.
2. **Decision** — own the context layout, route routine steps to cheaper models, and skip
   model calls entirely when memory/replay can safely act.
3. **Action** — use typed browser actions, settledness detection, self-healing element
   resolution, per-step assertions, and later speculative pre-execution.
4. **Learning** — record every run, learn playbooks/site memory/transition models, and feed
   that knowledge back into replay, hints, resolution, and prediction.

The first launch target is intentionally narrow and measurable:

```text
same browser tasks as Browser Use → fewer tokens → success parity → raw benchmark data
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

*Rote*: doing something from memory, by repetition, without re-deriving it. For browser
agents, that means the harness remembers how sites behave — observations, stable elements,
procedures, and verification signals — so the next run starts warmer.

## Status

**Early build.** The original foundations are built: data model, recorder, verified replay
executor, and benchmark harness. The current V1 work is the browser-agent harness from
[docs/17 — V1 launch plan](docs/17-v1-launch-plan.md): browser capture, perception
distillation, stable IDs, diff observations, budgeted context, and a reproducible
head-to-head benchmark against incumbent browser agents.

The current P1 foundation starts that V1 path with `@rote/browser`, `@rote/perception`,
`@rote/agent`, and static B1–B3 fixture pages.

![Implemented and target package topology](docs/diagrams/package-map.svg)

Solid packages exist today; dashed packages are the target composition described in
[docs/16 — Harness Architecture](docs/16-harness-architecture.md).

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
| [V1 launch plan](docs/17-v1-launch-plan.md) | The six-week launchable subset and its gates |
| [Product roadmap](docs/18-product-roadmap.md) | The full timeline: phases P0–P5 with exit and kill gates |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev workflow and PR conventions,
and [CLAUDE.md](CLAUDE.md) for the full engineering ruleset. Please also read
our [Code of Conduct](CODE_OF_CONDUCT.md). Found a security issue? See
[SECURITY.md](SECURITY.md) — please don't file it as a public issue.

## License

MIT — see [LICENSE](LICENSE).
