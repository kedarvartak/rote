# Magnitude 0.3.1 qualification adapter

This isolated adapter runs pinned, unmodified `magnitude-core@0.3.1` as an ordinary cold vision agent on canonical corrected B2. It is feasibility before certification, not a Magnitude-vs-Rote ranking. Nothing here ships in `@rote/cli`.

## Pin

| Item | Value |
|---|---|
| npm version | `0.3.1` |
| Integrity | `sha512-kfwfc8D4qo1JMcROhXRgPS1FTXPbtQnI8tHGJ2AXMDdUZWiD8+VHgHHBJcss0s/PqSkDmaaj4XOKzK0+iSwx0w==` |
| Shasum | `c21a57a282a27058e146923b2b9a46bdbaa79779` |
| npm `gitHead` | `f1b587c4173d8242bdb551991de54e70c4d2faf3` |
| License | Apache-2.0 |

The npm `gitHead` is inaccessible from the rewritten upstream refs, so the registry integrity and committed lockfile are authoritative.

## Install and collect

```bash
cd scripts/bench/magnitude
npm ci
cd ../../..
export OPENAI_API_KEY=...
CHROME_PATH=/path/to/chrome \
  node scripts/bench/magnitude/run-qualification.mjs \
  bench-out/magnitude-qualification/receipts.jsonl
```

The runner verifies package identity and canonical task/model/viewport, excludes initial navigation from measured agent execution, and caps each attempt at 90,000 ms. Checkpoints retain body text, action events, and aggregate usage events. A pending interrupted attempt becomes `abandoned` and is not rerun.

Magnitude 0.3.1 exposes aggregate `tokensUsed` events but not complete raw provider responses through this adapter. Aggregate values remain diagnostic; missing raw receipts prohibit token and cost ranking.

## Report and reproduce

```bash
node packages/bench/bin/rote-bench.js magnitude-qualification \
  bench-out/magnitude-qualification/receipts.jsonl \
  --records bench-out/magnitude-qualification/records.json \
  --out bench-out/magnitude-qualification/report.md \
  --summary bench-out/magnitude-qualification/summary.json

npm run reproduce:magnitude
```

See [T27](../../../docs/testing/T27-magnitude-qualification.md) for the bounded stop decision.
