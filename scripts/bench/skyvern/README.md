# Skyvern qualification adapter

This isolated adapter runs the unmodified Skyvern `v1.0.47` image against frozen B2/B5. It separates cold agent preparation from generated-code warm replay, runtime AI fallback, and post-run artifact changes. It is qualification tooling, not a production dependency of `@rotehq/cli`.

## Pin

| Item | Pin |
|---|---|
| Release | `v1.0.47` |
| Source commit | `9fc0b2aee079ee34ae3cdb578ca346f06c733218f` |
| Skyvern image index | `sha256:ad58d950f1c8cc3bc2d442228f701243b80b84494f11bbb066347ed034006e77` |
| PostgreSQL image index | `sha256:f1341c01408dc7278e9d365ed4f860cd3f87dd16b4464ac326fc0f422083a579` |
| License | AGPL-3.0 |
| Provider/model | OpenAI `gpt-4.1-mini` |

The source and image are used without patches. Docker, Python 3.11+, and an authorized OpenAI key are required.

## Collect

```bash
export OPENAI_API_KEY=...
python3 scripts/bench/skyvern/run-qualification.py \
  bench-out/skyvern-qualification/receipts.jsonl --fresh
```

`--fresh` deletes only `scripts/bench/skyvern/state/` and the selected output/raw directory. Omit it to resume append-safely. The runner caps cold preparation at six attempts and stops immediately if Skyvern declares success while the independent eight-field submission audit fails. Never commit `state/`; it contains credentials and database state.

Each successful cold preparation gets a distinct workflow and generated artifact. Its paired cells preserve the same workflow/artifact lineage and run unchanged warm replay plus all five frozen B5 mutations. The receipt records the script ID, revision used, artifact version/hash before and after, AI fallback, aggregate Skyvern LLM telemetry, exact external audit, and destructive-decoy dispatches.

Skyvern emits some code-review telemetry asynchronously after the run reaches a terminal state. Preserve the append-only collection and derive report input only after the runner exits:

```bash
python3 scripts/bench/skyvern/finalize-qualification.py \
  bench-out/skyvern-qualification/receipts.jsonl \
  bench-out/skyvern-qualification/finalized-receipts.jsonl
```

The derived rows separate runtime telemetry from post-run `script-reviewer` generation/regeneration telemetry. Runtime aggregate logs do not reliably split generated replay, repair, and AI-fallback usage. Skyvern's self-hosted logs expose per-call aggregate metrics, not raw OpenAI response receipts. The adapter therefore marks `provider_receipts_complete: false`; diagnostic telemetry cannot support token or dollar ranking.

## Report

```bash
node packages/bench/bin/rote-bench.js skyvern-qualification \
  bench-out/skyvern-qualification/finalized-receipts.jsonl \
  --records bench-out/skyvern-qualification/records.json \
  --out bench-out/skyvern-qualification/report.md \
  --summary bench-out/skyvern-qualification/summary.json
```
