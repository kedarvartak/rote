# Stagehand feasibility adapter

Runs the unmodified, integrity-pinned `@browserbasehq/stagehand@3.7.1` local DOM agent
against the canonical exact B2 oracle and frozen B5 mutations. This is an isolated
benchmark dependency; it is not shipped with `@rotehq/cli`.

## Install

```bash
npm ci --ignore-scripts
```

The lockfile is the package/version/integrity authority. The install currently reports 19
low-severity transitive advisories; the production CLI graph is unaffected.

## Collect

From the repository root:

```bash
OPENAI_API_KEY=... node scripts/bench/stagehand/run-qualification.mjs \
  bench-out/stagehand-qualification/receipts.jsonl 6
```

Collection is append-safe and resumable. A repetition starts with a fresh cold cache. Only
an independently verified cold success is snapshotted; that exact artifact is restored
before the unchanged warm run and each drift mutation so self-heal cannot contaminate the
next cell. Failed cold attempts remain in the receipts and have no paired cells.

The runner records Stagehand's conclusion, a fresh live-body exact check, cache identity
before/after, cache logs, aggregate metrics, exposed AI-SDK receipts, actions, and observed
body text. `provider_receipts_complete=false` prevents aggregate-only cold usage from
entering token or dollar rankings.

## Reproduce the stop decision

```bash
npm run reproduce:stagehand
```

This uses retained receipts and needs neither Chrome nor a provider key. See
[`T22`](../../../docs/testing/T22-stagehand-qualification.md).
