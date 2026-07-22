# T5 — Browser Use post-Apply completion smoke

| Field | Value |
|---|---|
| Date | 2026-07-22 |
| Protocol | `p1-g1-wordpress-v4-completion`, WP-N07 |
| Provider/model | OpenAI / `gpt-4.1-mini` |
| Harnesses | Rote and Browser Use 0.13.4 |
| Evidence | [Rote rows](data/T5-v4-rote-WP-N07.jsonl) · [Browser Use raw receipts](data/T5-v4-browser-use-WP-N07-raw.jsonl) · [normalized rows](data/T5-v4-browser-use-WP-N07.jsonl) |

## Finding and correction

Under v3, Browser Use applied the correct bulk action and the exact-title database verifier
passed, but it searched for the now-absent post and concluded failure. The failure remained
recorded; it was not relabeled as success. V4 gives both harnesses the same task-semantic
instruction: disappearance from All Posts after one Apply is expected completion evidence,
do not repeat the action, and let the independent verifier determine final success.

## Result

The fresh v4 pair passed:

| Harness | Provider calls | Concluded success | Exact-title verification |
|---|---:|---:|---:|
| Rote | 7 | yes | pass |
| Browser Use | 7 | yes | pass |

This is a one-pair instrument smoke, not comparison evidence. Every checkpoint still needs
canonical smokes followed by at least 15 successful runs per harness before E1.5 can draw
the publishable curve.
