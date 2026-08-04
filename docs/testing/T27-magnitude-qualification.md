# T27 — Magnitude 0.3.1 corrected-B2 qualification

**Date:** 2026-08-04  
**Milestone:** P1 competitor expansion  
**Protocol:** `magnitude-core-v0.3.1-b2-qualification-v1`

## Question

Does the current released Magnitude vision agent clear exact corrected-B2 reliability and evidence gates before any certification spend or Magnitude-vs-Rote ranking?

## Pin and isolation

| Item | Frozen value |
|---|---|
| Package | `magnitude-core@0.3.1` |
| npm integrity | `sha512-kfwfc8D4qo1JMcROhXRgPS1FTXPbtQnI8tHGJ2AXMDdUZWiD8+VHgHHBJcss0s/PqSkDmaaj4XOKzK0+iSwx0w==` |
| npm shasum | `c21a57a282a27058e146923b2b9a46bdbaa79779` |
| npm `gitHead` | `f1b587c4173d8242bdb551991de54e70c4d2faf3` |
| License | Apache-2.0 |
| Provider/model | OpenAI `gpt-4.1-mini` |
| Viewport | 1920×1080 |
| Mode | ordinary cold vision agent; no replay or repair path |

The published `gitHead` is no longer reachable from the upstream repository after its history replacement. The integrity-pinned npm tarball and committed lockfile are therefore the reproducible identity. The released package is imported unmodified from an isolated benchmark dependency tree and does not ship in `@rote/cli`.

## Frozen method

Magnitude received the canonical corrected-B2 prompt unchanged. Initial navigation to the canonical local fixture was unmeasured. Success required both:

1. Magnitude's `act()` call completing without error; and
2. a separate Playwright live-body capture containing the exact composite text with all eight requested values.

The protocol required three exact successes within at most six attempts. Every attempt had a frozen 90,000 ms limit to prevent an unbounded vision/action loop. A pending attempt is recovered as `abandoned` and never silently rerun. Any harness-success/oracle-failure case would stop collection immediately.

A pre-protocol exploratory invocation was manually terminated after ten minutes of repeated form-entry cycles. It is not evidence and is not in the denominator; it informed the explicit bounded-timeout safety rule before the protocol was committed.

Collection:

```bash
cd scripts/bench/magnitude
npm ci
cd ../../..
export OPENAI_API_KEY=...
CHROME_PATH=/path/to/chrome \
  node scripts/bench/magnitude/run-qualification.mjs \
  bench-out/magnitude-qualification/receipts.jsonl
```

## Result

**Decision: STOP before certification.**

| Audit | Result |
|---|---:|
| Cold exact success | **0/6** (95% Wilson **0.0–39.0%**) |
| Harness-declared success | **0/6** |
| Frozen 90 s timeouts | **6/6** |
| Harness-success/oracle-failure cases | **0** |
| Complete raw provider receipt sets | **0/6** |
| Attempts with aggregate usage events | **6/6** |
| Aggregate usage events retained | **22** |
| Actions observed before termination | **416** |
| B5 attempts | **0** |

All six attempts repeatedly interacted with the form but neither concluded nor reached the exact confirmation before the frozen timeout. Failed and timed-out attempts remain in the denominator.

Magnitude emitted aggregate `tokensUsed` events, but the released API did not expose the complete raw OpenAI responses required to independently reconcile cache buckets and provider totals. Aggregate telemetry is retained as diagnostic evidence; it is not a raw receipt and cannot support token or dollar ranking. Missing raw receipts are not represented as zero.

B5 was not run because corrected B2 failed both the exact-success and raw-receipt gates. Running drift diagnostics after that stop would add spend without qualifying a comparative cell.

## Conclusion

Pinned, unmodified Magnitude 0.3.1 does **not qualify** for certification on this protocol. This is a bounded feasibility stop, not evidence that Magnitude is universally unreliable or that Rote is superior. It supports no Magnitude-vs-Rote token, cost, latency, or success-rate ranking and says nothing about other Magnitude models, prompts, versions, or vision-oriented production sites.

## Frozen evidence

- [Protocol](data/T27-magnitude-protocol.json)
- [Isolated package lock](data/T27-magnitude-package-lock.json)
- [Append-only receipts, actions, exact body captures, and aggregate usage events](data/T27-magnitude-qualification-receipts.jsonl)
- [Diagnostic neutral records](data/T27-magnitude-neutral-records.json)
- [Deterministic summary](data/T27-magnitude-qualification-summary.json)
- [Generated stop report](T27-magnitude-level-report.md)

Reproduce the stop decision without a provider key:

```bash
npm run reproduce:magnitude
```
