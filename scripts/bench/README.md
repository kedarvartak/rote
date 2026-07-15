# Benchmark scripts

Local, deterministic M3 smoke scripts plus the live-run contract for producing
the real M3 gate report.

For the V1 launch number (Rote vs Browser Use, tokens per task at success parity),
see [`headhead/README.md`](headhead/README.md).

For real frozen browser-agent runs, start with
[`run-live-benchmark.md`](run-live-benchmark.md) and
[`live-b1-b3-plan.example.json`](live-b1-b3-plan.example.json).

## B1 smoke

```bash
rm -rf /tmp/rote-b1-bench
node packages/bench/bin/rote-bench.js run scripts/bench/frozen-b1-plan.json --out /tmp/rote-b1-bench
node packages/bench/bin/rote-bench.js report /tmp/rote-b1-bench/bench-spec.json --out /tmp/rote-b1-bench/report.md
node packages/bench/bin/rote-bench.js gate /tmp/rote-b1-bench/bench-spec.json
```

## B1–B3 smoke

```bash
rm -rf /tmp/rote-b1-b3-bench
node packages/bench/bin/rote-bench.js run scripts/bench/frozen-b1-b3-plan.json --out /tmp/rote-b1-b3-bench
node packages/bench/bin/rote-bench.js report /tmp/rote-b1-b3-bench/bench-spec.json --out /tmp/rote-b1-b3-bench/report.md
node packages/bench/bin/rote-bench.js gate /tmp/rote-b1-b3-bench/bench-spec.json
```

What it runs:

- B1 cold drives the Recorder around the fake browser MCP downstream with 40
  tool calls: 35 deliberate exploratory dead ends plus the 5 essential B1 calls.
- B1 warm drives `rote-replay` against
  `fixtures/playbooks/b1-download-report.yaml`.
- B2 cold records vendor-registration exploration and form-fill calls; B2 warm
  replays `playbooks/b2-vendor-registration-smoke.yaml`, a deterministic
  no-LLM variant of the production B2 fixture so the smoke stays offline.
- B3 cold records catalog-search exploration and extraction calls; B3 warm
  replays `fixtures/playbooks/b3-catalog-search.yaml`.
- All runs write usage sidecars so the normal `rote-bench report` and `gate`
  paths are exercised.

## Perception serializer parity

Capture Browser Use's exact model-facing observation text as described in
[`browser-use-observations/README.md`](browser-use-observations/README.md), then run:

```bash
node packages/bench/bin/rote-bench.js serializer-report scripts/bench/browser-use-serializer-spec.example.json --out /tmp/rote-serializer-report.md
node packages/bench/bin/rote-bench.js serializer-gate scripts/bench/browser-use-serializer-spec.example.json
```

The gate requires Rote to be no larger on every fixture, not merely in aggregate. Counts
are explicitly approximate (`ceil(chars / 4)`); provider-billed tokens belong to W5.

This is still **not** the M3 thesis number: it uses a fake downstream and fake
token sidecars. It proves that real Rote CLIs integrate with the benchmark
harness end to end. The remaining M3 work is replacing these fake commands with
live/frozen B1–B3 browser-agent commands and real provider usage.
