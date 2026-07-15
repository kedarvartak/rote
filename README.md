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
[docs/02](docs/02-architecture.md)):

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

**Early build — no launch number yet.**

Built and working end to end: core schemas + Expect DSL, lossless recorder, verified
replay executor, CDP browser backend, perception (distill → stable IDs → diff → budget),
the agent loop, cache-aware context assembly, tagged LLM accounting, and the benchmark +
head-to-head gate. First live run against a real browser and model
([T1](docs/testing/T1-openai-dry-run.md)) completed B1 in the minimum four actions.

Not built: the playbook distiller (V1 replays hand-written playbooks), the matcher, site
memory, model routing, speculation. `docs/02-architecture.md` §Status is authoritative.

**Blocked:** T1 found that the live agent's mandatory action `expect` asks the model to
predict page text it has not seen, so a correctly-completed task is recorded as a failure
([#49](https://github.com/kedarvartak/rote/issues/49)). The benchmark matrix waits on
that fix — running it today would measure our bug, not our efficiency. **No number, no
launch.**

![Implemented and target package topology](docs/diagrams/package-map.svg)

Solid packages exist today; dashed packages are the target composition described in
[docs/02 — Architecture](docs/02-architecture.md).

## Docs

| Doc | Contents |
|---|---|
| [01 — Problem](docs/01-problem.md) | Why agents re-derive everything; the reuse-path gap; where Rote fits and where it doesn't |
| [02 — Architecture](docs/02-architecture.md) | **What is built vs designed**; the four planes; control loop; playbooks; repair ladder; memory; speculation; invariants |
| [03 — Benchmark](docs/03-benchmark.md) | Task suite, metrics, fairness rules, the variance rule, the launch gate, generalization |
| [04 — Competition](docs/04-competition.md) | The field, per-competitor teardown, capability matrix, steelmanned objections |
| [05 — Roadmap](docs/05-roadmap.md) | Where we are; V1 scope and gates; P0–P5; open questions |
| [06 — Optimizations](docs/06-optimizations.md) | The master catalog: every optimization, tier, status, evidence |
| [testing/](docs/testing/) | Records of tests against real Rote — live browser, live model, live key |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev workflow and PR conventions,
and [CLAUDE.md](CLAUDE.md) for the full engineering ruleset. Please also read
our [Code of Conduct](CODE_OF_CONDUCT.md). Found a security issue? See
[SECURITY.md](SECURITY.md) — please don't file it as a public issue.

## License

MIT — see [LICENSE](LICENSE).
