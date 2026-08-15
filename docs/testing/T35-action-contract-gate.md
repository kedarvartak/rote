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
