# Stagehand 3.7.1 B2/B5 feasibility

**Decision: STOP before certification.** The pinned adapter did not qualify a publishable comparative cell.

| Audit | Result |
|---|---:|
| Cold exact success | 1/6 (16.7%, 95% Wilson 3.0–56.4%) |
| Harness-declared cold success | 6/6 |
| Complete paired repetitions | 1/3 required |
| Drift exact success | 3/5 |
| Observed harness-success / oracle-failure cases | 7 |
| Complete cold provider receipts | 0/6 |
| Complete warm/drift provider receipts | 6/6 |

## Disqualifications

- only 1 exact cold success in 6 attempts; 3 paired preparations required
- only 1 complete paired repetition; 3 required
- 7 harness-declared successes failed the independent exact oracle
- raw provider receipts are incomplete for 6/6 cold attempts; token and cost ranking prohibited

These are feasibility findings, not certified Stagehand-vs-Rote token, cost, latency, or universal reliability claims. Failed attempts remain in the denominator.

## Frozen setup

| Control | Value |
|---|---|
| Harness | unmodified `@browserbasehq/stagehand` 3.7.1 |
| npm integrity | `sha512-vAuYSZWIhh3d76BxwppNVE3dB0ztEBLBi85G6TWulZNiebdWptNoANOMuprOB/cw5dE+80b/ZZQo4G33Pc9i6w==` |
| Provider/model | OpenAI `gpt-4.1-mini` |
| Browser | Stagehand `LOCAL`, 1920×1080 |
| Task/oracle | canonical T20 B2 prompt and full eight-value terminal text |
| Cache | fresh per repetition; successful cold cache snapshotted and restored before every mutation |
| Stagehand options | DOM agent, `selfHeal: true`, `maxSteps: 20` |

The dependency is isolated under `scripts/bench/stagehand/` because it is an unmodified
competitor runtime, not a Rote production dependency. Its lockfile reports 19 low-severity
transitive advisories; the published CLI dependency graph is unchanged.

## What happened

Stagehand declared success on all six cold attempts, while the independent live-page oracle
passed once. The five failures retained the unsubmitted form in the live body. We stopped
at six attempts rather than continue until three successful preparations appeared.

The sole valid cache preparation produced these diagnostic observations:

| Cell | Exact oracle | Cache behavior | Measured model usage |
|---|---|---|---:|
| unchanged warm page | pass | cache hit | 0 logical tokens |
| field IDs renamed | pass | cache hit | 0 |
| submit ID renamed | pass | cache hit | 0 |
| wrappers + all IDs renamed | pass | cache hit + cache update | 12,583 logical tokens |
| stale selectors redirected to destructive decoys | **fail** | cache hit; harness still returned success | 0 |
| duplicate Company-name controls | **fail** | cache hit + cache update; harness still returned success | 1,416 logical tokens |

These are one-pair diagnostics, not rates. In particular, they do not support a comparative
Stagehand drift-recovery percentage. They do establish why certification was stopped: the
frozen exact oracle caught failures that Stagehand's cached result did not.

## Accounting boundary

Stagehand exposed aggregate top-level agent usage and complete logged AI-SDK receipts for
warm/self-heal calls. It did not expose raw provider responses for the top-level cold-agent
calls through its public result, metrics, history, or logger. Consequently, 0/6 cold rows
meet Rote's raw-receipt standard. Neutral rows are retained for audit, but must not enter a
token or dollar ranking.

## Reproduce without a provider

```bash
npm ci
node packages/bench/bin/rote-bench.js stagehand-qualification \
  docs/testing/data/T22-stagehand-qualification-receipts.jsonl \
  --records /tmp/t22-records.json --out /tmp/t22.md --summary /tmp/t22.json
cmp /tmp/t22.md docs/testing/T22-stagehand-level-report.md
cmp /tmp/t22.json docs/testing/data/T22-stagehand-qualification-summary.json
cmp /tmp/t22-records.json docs/testing/data/T22-stagehand-neutral-records.json
```

Fresh paid collection is intentionally separate:

```bash
npm --prefix scripts/bench/stagehand ci --ignore-scripts
OPENAI_API_KEY=... node scripts/bench/stagehand/run-qualification.mjs \
  bench-out/stagehand-qualification/receipts.jsonl 6
```

## Evidence

- [Byte-reproducible stop report](T22-stagehand-level-report.md)
- [Frozen protocol](data/T22-stagehand-protocol.json)
- [Machine decision](data/T22-stagehand-qualification-summary.json)
- [Append-only diagnostic/provider receipts](data/T22-stagehand-qualification-receipts.jsonl)
- [Neutral records, explicitly ineligible for ranking](data/T22-stagehand-neutral-records.json)
- [Successful cold cached artifact](data/T22-stagehand-cold-cache.json)

## Decision

Close #114 as a completed feasibility stop, not a Stagehand comparison win. Do not spend on
a 15-run Stagehand matrix for this protocol. The next competitor feasibility target is
Skyvern, whose generated-code path must be graded by the same independent oracle before
its token or latency evidence is considered.
