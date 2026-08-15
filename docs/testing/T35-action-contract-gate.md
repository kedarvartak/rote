# T35 — Structural action-contract drift gate

**Date:** 2026-08-15  
**Milestone:** P2 cross-cutting priority (#143)  
**Source:** issue #143; B2 registration fixtures (`fixtures/sites/b2-vendor-form.html`, `fixtures/sites/drift/`)

## Question

When a control keeps its identity (role, name, stable id) but its *behavioral contract*
changes — an `<input>` that became a `<textarea>` so Enter no longer submits, a
same-named submit whose destination or method changed, a benign navigation that became a
POST purge — does replay stop **before dispatch** with a typed `contract_mismatch`, while
cosmetic redesign, selector rename, and wrapper/remount drift keep replaying, and a UI-only
confirmation still never counts as success?

This is the trust gate the enterprise sequence was built toward ([05](../05-roadmap.md)
"Priority: structural action-contract drift"). It is deterministic; the exact external
oracle remains authoritative for outcomes (E7.4).

## Contract

- **Schema** (`ActionContractSchema`, `@rote/core`, strict, version 1): verb; target
  `{role, name, stable_id?, context_hash?}`; affordance `{control, input_type?,
  enter_behavior, destination_hash?, form_method?, draggable}`; safety
  (`read|local_input|navigation|potentially_mutating|mutating`); preconditions
  `{visible: true, enabled}`; optional `required_effect {evidence_class, kind?}`. No
  captured value, credential, href, or query string can enter it — unknown fields fail to
  parse; destinations are 16-hex digests of origin+pathname.
- **Derivation** (`deriveActionContract`, `@rote/action`) is pure over the distilled node's
  new `affordance` (perception derives it from capture-time attributes plus the
  `data-rote-form-action|method|implicit-submit` facts both the CDP decorator and the static
  parser stamp). Static and CDP captures of the same document derive byte-identical
  contracts (asserted in real Chrome).
- **Safety on this control**: click on link or GET submit → `navigation`; POST submit →
  `mutating`; checkbox/radio → `local_input`; opaque button → `potentially_mutating`;
  other verbs keep their E7.5 baseline.
- **Compatibility matrix** (`compareActionContracts`):

  | Change | Verdict |
  |---|---|
  | selector, wrapper/container, cosmetic (not in the contract) | compatible |
  | accessible name or stable id (identity already re-resolved) | compatible, reported as drift |
  | verb, role, browsing context | `contract_mismatch` |
  | control kind, input type, Enter behavior, draggable | `contract_mismatch` |
  | destination path digest, form method | `contract_mismatch` |
  | safety class, either direction | `contract_mismatch` |
  | enabled ↔ disabled | `contract_mismatch` |
  | required effect declared on both sides and different | `contract_mismatch` |

- **Gate**: a replayed step whose args carry `contract` makes `BrowserToolCaller` capture,
  resolve, derive the live contract for the resolved node, and compare — mismatch throws
  `ActionContractMismatchError` (`BROWSER_CONTRACT_MISMATCH`) before any backend call.
  `runPlaybook` surfaces it as `outcome: fallback` with `failureCode`, `failedStepId`, and
  the untouched `completedStepIds` — a fallback never implies rollback of what already ran.
- **Recording**: the live loop attaches the derived contract to every element step
  (`BrowserAgentStep.actionContract`); that is what distiller v1 may persist.

## Deterministic results

| Case | Result |
|---|---:|
| Frozen B2 form, contract-gated playbook (static replay) | success, 0 LLM calls, contract `compatible`, drift `[]` |
| Cosmetic redesign (`b2-contract-cosmetic.html`: wrappers, classes, renamed ids) | success; identity healed, contract equal |
| Selector rename (`b2-selector-renamed.html`) | success; both steps `repaired`, contract equal |
| Wrapper/landmark inserted (`b2-wrapper-inserted.html`) | compatible; `stable_id` drift only |
| `#company-name` became `<textarea>` (`b2-contract-textarea.html`) | fallback at `fill_company`, `BROWSER_CONTRACT_MISMATCH` (`single_line_text → multi_line_text`, `submits_form → inserts_newline`), 0 fills, 0 clicks |
| Same-named submit, destination changed (`b2-contract-destination.html`) | fallback at `submit_registration`, mismatch `destination` only, fill kept in `completedStepIds`, 0 clicks |
| Same-named submit became POST purge with fake confirmation banner (`b2-contract-destructive.html`) | fallback, mismatch `destination` + `safety navigation → mutating`, 0 clicks, **no success despite the banner** |
| Real Chrome: static vs CDP derivation on the frozen form | identical contracts (fill + submit) |
| Real Chrome: textarea / destructive variants through the CDP gate | `BROWSER_CONTRACT_MISMATCH`, field untouched, no navigation, form still present |
| Schema strictness / reflexivity / symmetry / name-drift-vs-precondition | property-tested (fast-check) |
| Live loop records value-free contract per element step | asserted; typed value absent |

## Public demonstration

`npm run demo:action-contract` (`scripts/demo/action-contract-drift-demo.ts`) replays one
recorded procedure against six versions of one page in a real headless Chrome with zero
model calls, all served from the same URL so identity, destination digest, and fingerprint
compare like-for-like. Act 0 derives each element step's value-free contract from a live
capture of `fixtures/sites/contract-drift/v1-frozen.html`; the acts then run through the
production executor (`runPlaybook` + `BrowserToolCaller`). The fixture server counts hits
on the purge endpoint — that counter, not the UI banner, is the demo's external oracle.

| Act | Page | Outcome | Dispatched (fill / click) | Purge hits |
|---|---|---|---:|---:|
| 1 | full cosmetic redesign (`v2-cosmetic.html`) | success, contract equal | 1 / 1 | 0 |
| 2 | ids renamed + form remounted under new landmarks (`v3-selector-remount.html`) | success, both steps repaired from identity | 1 / 1 | 0 |
| 3 | same-named field became `<textarea>` (`v4-textarea.html`) | fallback `BROWSER_CONTRACT_MISMATCH` (`single_line_text → multi_line_text`, `submits_form → inserts_newline`) | 0 / 0 | 0 |
| 4 | same-named submit, destination moved (`v5-destination.html`) | fallback `BROWSER_CONTRACT_MISMATCH` (`destination`) | 1 / 0 | 0 |
| 5 | same-named submit became POST purge behind a fake "complete" banner, **gate on** (`v6-destructive.html`) | fallback `BROWSER_CONTRACT_MISMATCH` (`destination`, `get → post`, `navigation → mutating`) | 1 / 0 | **0** |
| 5′ | the same purge page with the contract gate **off** (blind replay, contrast) | "success" by UI verify | 1 / 1 | **1** |

Act 5′ is the point of the whole gate: without it, the click lands, the purge fires, and a
UI-only verifier reports success. Recording: [`docs/demo/action-contract-drift-demo.gif`](../demo/action-contract-drift-demo.gif);
frozen acts: [`data/T35-action-contract-drift-demo.json`](data/T35-action-contract-drift-demo.json).
CI runs the demo self-checked (`--json`) in the Chrome section so a regression is loud.

## What this does not claim

- Contracts are as expressive as the capture: destructiveness is inferred from observable
  facts (method, destination, control kind), not from button labels or server semantics.
  A same-path, same-method handler whose server behavior changed is E7.4's job (exact
  authoritative outcome), not this gate's.
- Existing playbooks without `contract` args keep their previous replay behavior; the
  distiller (next) is what will author contracts automatically.

## Reproduce

```bash
npx vitest run packages/core/test/action-contract.test.ts \
  packages/action/test/action-contract-gate.test.ts \
  packages/executor/test/invariants/action-contract-gate-never-dispatches-mismatch.test.ts \
  packages/agent/test/action-contract-recorded.test.ts
ROTE_RUN_CDP_TESTS=1 npx vitest run packages/executor/test/cdp-action-contract-gate.test.ts   # requires Chrome/Chromium
```
