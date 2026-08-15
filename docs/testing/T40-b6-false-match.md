# T40 — B6 false-match certification (T4 near-miss, deterministic)

**Date:** 2026-08-16  
**Milestone:** P2 — benchmark B6 (docs/03 "the most important row"), matcher discipline (T4)  
**Source:** `fixtures/sites/b6-vendor-offboarding.html`; `packages/matcher/test/invariants/b6-false-match.test.ts`; `packages/executor/test/cdp-action-contract-gate.test.ts` (Chrome)

## Question

docs/03: "B6 — superficially like B2, genuinely different — the false-match test (must
miss). A benchmark that only rewards replaying is a benchmark you can win by replaying
wrongly." And T4: any false replay is a design kill. With the matcher (T0 selection) and
the learning loop now in the product, does a B6 task ever get the B2 procedure — and if a
caller forces it, can anything wrong happen?

## The fixture

`b6-vendor-offboarding.html` is B2 to the eye and to identity v2: same title, the same
eight labelled fields with the same ids and names, the same submit label. It differs in
what it *does*: the form posts to `/vendors/offboard` (removal), and its confirmation reads
"Vendor removed from the register". Nothing about it is cosmetic.

## Certification (defence in depth)

| Layer | Check | Result |
|---|---|---|
| 1. Matcher (T4) | B6-shaped tasks against the B2 playbook in the library: "Submit the vendor **de**registration company field …", "Remove Acme Tools from the vendor register", "Offboard the vendor Acme Tools", "… then delete the vendor" | all `no_match` (`below_threshold`); the genuine B2 task still matches |
| 2. Forced replay, B6 at its own URL (static) | B2 contract playbook replayed against B6 | fills dispatch (identity resolves), submit refused `BROWSER_CONTRACT_MISMATCH` (destination + `get → post` + `navigation → mutating`), **zero clicks**, `fallback` |
| 3. Forced replay, B6 swapped in at B2's URL | the site changed what the form does | same verdict, zero clicks |
| 4. Control | same playbook on real B2 | walks through, succeeds |
| 5. Real Chrome | B6 served by the fixture server; fill then submit through the CDP gate | fill lands, click refused before dispatch, no navigation, form present, confirmation hidden |

**Finding fixed on the way:** the v1 matcher scored "Submit the vendor deregistration
company field with contract-gated replay" at Jaccard **0.82** against the B2 intent — a
one-word semantic flip diluted by a long sentence would have cleared τ = 0.8. The matcher
now also requires **coverage**: every content token of the playbook's intent (slots and
function words aside) must appear in the task, else the score is 0. A task that never says
"registration" cannot select a registration procedure, however similar the rest is.

## What this does not claim

- Coverage + Jaccard is a lexical discipline; a paraphrase that means B2 with none of its
  words will *miss* (a T0 loss, never a T4 false replay), and a task that repeats the
  intent's words while meaning something else would need the contract gate and verify —
  which is why layers 2–5 exist and are certified separately.
- B4 (judgment gate) remains unbuilt.

## Reproduce

```bash
npx vitest run packages/matcher/test/invariants/b6-false-match.test.ts
ROTE_RUN_CDP_TESTS=1 npx vitest run packages/executor/test/cdp-action-contract-gate.test.ts   # requires Chrome/Chromium
```
