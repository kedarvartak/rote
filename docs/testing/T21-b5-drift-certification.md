# B5 deterministic drift certification

Protocol `p1-b5-b2-drift-v1`; 18+ attempts per mutation.

**Result: PASS.**

| Metric | Result | Gate |
|---|---:|---:|
| Drift recovery without full fallback | 100.0% [94.9–100.0%] | 95% lower bound ≥70% |
| Silent failure | 0.0% [0.0–4.1%] | 0 observed |
| Adversarial fail-closed | 100.0% [82.4–100.0%] | 100% observed |
| Repair/cold logical-token ratio | 0.0% | ≤25% |
| Mean repaired steps | 5.0 | report |
| Mean repaired-run latency | 173.2 ms | report |

90 deterministic real-Chrome attempts cover 4 recoverable mutation classes and 1 adversarial ambiguity class. The cold denominator is 8354.1 logical tokens from the corrected T20 B2 matrix. Repair here means deterministic semantic target resolution before dispatch; it is not generic rollback or an LLM repair agent.

## Mutation matrix

| Mutation | Expected boundary | Attempts | Result | Mean repaired steps |
|---|---|---:|---|---:|
| all field IDs renamed | recover | 18 | 18 exact successes | 8 |
| submit ID renamed | recover | 18 | 18 exact successes | 1 |
| wrappers inserted + every ID renamed | recover | 18 | 18 exact successes | 9 |
| stale selectors point to destructive decoys | recover without touching decoys | 18 | 18 exact successes | 2 |
| duplicate grounded Company-name controls | fail closed | 18 | 18 detected fallbacks | 0 |

Each recovered action is resolved from the stale playbook's semantic identity against the
current distilled DOM before dispatch. Conflicting or duplicate identity is not guessed.
Every success must expose the full T20 eight-value terminal string in a fresh live capture.
A replay conclusion without that string is counted as a silent failure.

## Interpretation

B5 certifies a narrow capability: selector-level drift covered by stable identity or exact
role/name can be repaired without an LLM or full-agent fallback. It does **not** certify
arbitrary workflow repair, changed task semantics, server-side rollback, learned matching,
or recovery after an already-dispatched side effect. Ambiguity reaches the previously
proved classified cold fallback in the product path; this matrix grades the replay boundary
itself so fallback tokens are not mislabeled as repair tokens.

## Reproduce

```bash
npm ci
npm run reproduce:b5

# Optional fresh real-Chrome collection:
node --import tsx scripts/bench/headhead/rote/run-b5.ts /tmp/t21-fresh.jsonl 18
```

The published-receipt report is byte-reproducible without Chrome or a provider. Fresh-run
latency is diagnostic and may differ by machine; outcome/repair counts and zero-token
accounting are deterministic invariants.

## Evidence

- [Byte-reproducible generated report](T21-b5-level-report.md)
- [Machine summary](data/T21-b5-drift-summary.json)
- [Append-only attempt receipts](data/T21-b5-drift-records.jsonl)
- [90 executor manifests](data/T21-b5-drift-manifests.json)
- [Full replay trajectories with target-resolution receipts](data/T21-b5-drift-trajectories.jsonl)
