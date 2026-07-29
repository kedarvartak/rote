# Browser Use 0.13.7 refresh adapter

This isolated adapter qualifies the current Browser Use release without rewriting the frozen 0.13.6 G1/G2 baseline. It runs corrected B2 and the five B5 pages as ordinary cold re-reasoning; Browser Use has no replay path in this comparison. Nothing here ships in `@rote/cli`.

## Pin

| Item | Pin |
|---|---|
| Release | `0.13.7` |
| Source commit | `f0aa3a8bb03779c71a5aa262d389e3bfe6b77cdc` |
| Wheel | `browser_use-0.13.7-py3-none-any.whl` |
| Wheel SHA-256 | `2264439e45cc7dd7fe480ca37e9eabd040c31a4e4d5e20c069ad2f60c07e3ba8` |
| License | MIT |
| Provider/model | OpenAI `gpt-4.1-mini` |
| Viewport | 1920×1080 |

The release is imported unmodified. The adapter reuses the historical public Browser Use driver for model construction, provider-receipt normalization, and independent CDP terminal-text capture; qualification orchestration is separate so 0.13.6 evidence and configuration remain frozen.

## Prepare

```bash
scripts/bench/browser-use-refresh/prepare-venv.sh /tmp/rote-browser-use-0.13.7
```

The preparation script downloads the exact wheel, verifies its SHA-256 before installation, installs dependencies into the isolated venv, and checks the installed version.

## Collect

```bash
export OPENAI_API_KEY=...
/tmp/rote-browser-use-0.13.7/bin/python \
  scripts/bench/browser-use-refresh/run-qualification.py \
  bench-out/browser-use-0137-qualification/receipts.jsonl
```

Collection stops after three exact canonical successes or six attempts. Only after that gate clears does it run one cold attempt on each B5 mutation. A persisted pending attempt becomes `abandoned` after interruption and is never silently rerun. Per-attempt dumps are durable before the append-only receipt; missing provider usage remains `null`, never zero.

Any harness-success/oracle-failure case stops collection. Every measured row must reconcile raw OpenAI receipts to uncached, cache-read, cache-write, and output buckets.

## Report

```bash
node packages/bench/bin/rote-bench.js browser-use-refresh \
  bench-out/browser-use-0137-qualification/receipts.jsonl \
  --records bench-out/browser-use-0137-qualification/records.json \
  --out bench-out/browser-use-0137-qualification/report.md \
  --summary bench-out/browser-use-0137-qualification/summary.json
```

A qualification decision allows only a separately frozen ≥15-run corrected-B2 certification. It does not publish refreshed performance rankings by itself.
