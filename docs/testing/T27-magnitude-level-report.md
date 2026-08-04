# Magnitude 0.3.1 corrected-B2 feasibility

**Decision: STOP before certification.** The pinned adapter did not qualify a publishable comparative cell.

| Audit | Result |
|---|---:|
| Cold exact success | 0/6 (0.0%, 95% Wilson 0.0–39.0%) |
| Harness-declared success | 0/6 |
| Frozen 90 s timeouts | 6/6 |
| Abandoned attempts | 0 |
| Observed harness-success / oracle-failure cases | 0 |
| Complete raw provider receipt sets | 0/6 |
| Attempts with aggregate usage events | 6/6 |
| Aggregate usage events retained | 22 |
| Actions observed before termination | 416 |
| B5 attempts | 0 |

## Disqualifications

- only 0 exact cold successes in 6 attempts; 3 required
- raw provider receipts are incomplete for 6/6 attempts; token and cost ranking prohibited

Magnitude usage events remain diagnostic because complete raw provider responses were unavailable. This report publishes no Magnitude-vs-Rote token, cost, latency, or universal reliability claim. Timed-out and abandoned attempts remain in the denominator; missing usage is not zero. B5 was not run after corrected B2 failed the qualification gates.
