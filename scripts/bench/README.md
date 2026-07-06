# Frozen benchmark scripts

Local, deterministic M3 smoke scripts that exercise the real Recorder and Replay
Executor CLIs before the live browser demo environment exists.

## B1 smoke

```bash
rm -rf /tmp/rote-b1-bench
node packages/bench/bin/rote-bench.js run scripts/bench/frozen-b1-plan.json --out /tmp/rote-b1-bench
node packages/bench/bin/rote-bench.js report /tmp/rote-b1-bench/bench-spec.json --out /tmp/rote-b1-bench/report.md
node packages/bench/bin/rote-bench.js gate /tmp/rote-b1-bench/bench-spec.json
```

What it runs:

- `run-b1-cold.mjs` drives the Recorder around the fake browser MCP downstream
  with 40 tool calls: 35 deliberate exploratory dead ends plus the 5 essential
  B1 calls.
- `run-b1-warm.mjs` drives `rote-replay` against
  `fixtures/playbooks/b1-download-report.yaml` and the same fake downstream.
- Both write usage sidecars so the normal `rote-bench report` and `gate` paths
  are exercised.

This is still **not** the M3 thesis number: it uses a fake downstream and fake
token sidecars. It proves that real Rote CLIs integrate with the benchmark
harness end to end. The remaining M3 work is replacing these fake commands with
live/frozen B1–B3 browser-agent commands and real provider usage.
