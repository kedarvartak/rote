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
