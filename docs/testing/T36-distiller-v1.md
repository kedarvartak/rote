# T36 — Distiller v1: trajectory → playbook

**Date:** 2026-08-15  
**Milestone:** P2 item 8 (tier 1, episodic memory)  
**Source:** docs/05-roadmap.md P2 item 8; docs/07-execution-plan.md "Distiller v1"

## Question

Can one successful browser trajectory, recorded through the real loop, be turned
deterministically into a playbook that the replay executor runs **with zero model calls
and zero human edits** — carrying identity v2, browsing context, and the recorded action
contract (#143), asserting only what was strongly observed, and never persisting a typed
value?

## Contract

- **Input**: `FileBrowserAgentRunRecorder` output (manifest + trajectory JSONL with
  inline/blob results). Only `outcome: success` runs load.
- **Keep/prune** (every prune reported with a reason): keep events whose post-action
  evidence exists (the record that the action executed); prune `done`, pre-dispatch
  failures, unknown tools, and superseded fill/select writes on the same target identity
  (last write wins — a corrected value is replayed once).
- **Identity**: resolved selector (what actually dispatched), stableId, role/name/text,
  contextHash; `contract` copied verbatim from the recorded `actionContract` so replay is
  contract-gated before dispatch.
- **Assertions**: `expect` only from strong evidence — `input_value … equals {{param}}` for
  fill/select, `url_contains <path>` for navigate; click/hover/press/upload/drag get no
  synthesized assertion. `verify` is caller-declared.
- **Parameterization**: every declared param value is replaced by `{{name}}` in dispatched
  values, URLs, expectations, and the intent text; a fill/select value matching no param
  fails (`UnparameterizedValueError`, names the step, never the value) unless literals are
  explicitly allowed. Unused params are dropped from the playbook.
- **No model call**: invariant 5's `distill` tag stays unused in v1 by design.

## Gate results

| Case | Result |
|---|---:|
| Static B2: record through `runBrowserAgent` (scripted, 0 tokens) → distill → replay untouched YAML | success, 10 steps, 9 contract-bearing, 0 LLM calls, 8/8 values applied, none literal in YAML |
| Same distilled playbook, selector renamed | success; `fill_company_name` repaired to `#company-name-v2` |
| Same distilled playbook, submit became POST purge | fallback at `click_submit_registration`, `BROWSER_CONTRACT_MISMATCH`, 0 clicks, 9 completed steps reported |
| Real Chrome B1 (login + download): record → distill → CDP replay | success; `secret`/`analyst` absent from YAML; download confirmation present |
| Real Chrome B2 (8 fields): record → distill → CDP replay | success; exact `#registration-summary` equals the templated summary |
| Pruning report | `not_dispatched`, `terminal_done`, `superseded_write` each asserted |
| Undeclared value | typed failure naming the step, value never in the message; `literalValues: 'allow'` opt-in |
| Param leak (property, fast-check) | no declared value survives in any dispatched value or `equals` |
| YAML round trip | `parsePlaybookYaml(writePlaybookYaml(p))` equals `p` |

## What this does not claim

- No matcher: playbook selection is still the caller's (CLI flag / explicit candidate).
- No causal analysis beyond dispatch evidence and last-write-wins; dead-end exploration
  that *did* dispatch is kept (replaying it is harmless and honest, pruning it would be a
  guess).
- No learned `verify`: the final oracle is declared by the caller, and authoritative
  outcome requirements (E7.4) are not yet expressed in playbook YAML.

## Reproduce

```bash
npm test --workspace @rote/distiller
npm run test:distill-chrome --workspace @rote/distiller   # requires Chrome/Chromium
```
