# T7 — Browser Use long-cell qualification

| Field | Value |
|---|---|
| Date | 2026-07-22 |
| Provider/model | OpenAI / `gpt-4.1-mini` |
| Evidence | [0.13.4 N15 ×3](data/T7-browser-use-0134-N15-raw.jsonl) · [0.13.6 accessible N15](data/T7-browser-use-0136-N15-accessible-raw.jsonl) · [0.13.6 accessible N20](data/T7-browser-use-0136-N20-accessible-raw.jsonl) · [Rote N20](data/T7-rote-N20-accessible.jsonl) |

## Question

Can the exact-set bulk-checkbox task produce enough successful Browser Use long-cell runs
to support at least 15 successes per harness without weakening verification?

## Changes tested

1. Upgrade the competitor dependency from Browser Use 0.13.4 to current 0.13.6.
2. Expose WordPress's existing screen-reader checkbox names directly as `aria-label`s.
   This is symmetric accessibility metadata, not a benchmark-only selector.
3. Install the same pre-Apply exact-set safety condition Rote uses. Browser Use receives a
   visible alert and may repair, but a wrong set cannot trigger the irreversible action.

The accessibility change leaves T2 unchanged across 15 fresh sessions: 47,214 characters,
~11,804 tokens, and zero range.

## Result

| Configuration | Cell | Successes | Result |
|---|---|---:|---|
| Browser Use 0.13.4, v5 default | WP-N15 | 1/3 | too sparse |
| Browser Use 0.13.6, accessible rows + guard | WP-N15 | 1/1 | pass smoke |
| Browser Use 0.13.6, accessible rows + guard | WP-N20 | 0/1 | fail; guard prevented wrong set |
| Rote, accessible rows | WP-N20 | 1/1 | pass exact verifier |

The N20 baseline repeatedly toggled rows after losing track of selected state. Increasing
attempt count would turn certification into expensive success hunting, and publishing only
successful tails would hide the reliability result.

## Decision

**No-go for certification on the bulk-checkbox long cells.** Keep the provider upgrade,
accessibility semantics, symmetric irreversible-action guard, and all failed receipts.
Issue #92 must replace the long cells with independently verifiable one-target operations
on the same real 10K-token WordPress environment. E1.5 remains blocked; no graph or token
percentage is publishable from this qualification data.
