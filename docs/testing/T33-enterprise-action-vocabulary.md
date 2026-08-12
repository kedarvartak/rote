# T33 — Enterprise action vocabulary

**Date:** 2026-08-12  
**Milestone:** P2 / E7.5  
**Source:** issue #131; E7.1 protocol `p2-enterprise-contract-corpus-v1`

## Question

Can hover, explicit keyboard chords, allowlisted file upload, and target-to-target
drag/drop dispatch as grounded product verbs — through the shared Zod contract used by
the planner, live agent, replay executor, and CDP backend — such that the frozen E7.1
control oracles pass exactly, file material never leaves the dispatch edge, chords are
never arbitrary script, and unsupported backends fail typed with clean fallback?

This is a deterministic verb qualification. It is not SPA endurance (E7.6), multi-session
continuation (E7.7), or structural action-contract compatibility (#143).

## Contract

- **Verbs**: `hover`, `press`, `upload`, `dragAndDrop` join the planner action union with
  the same stableId/role/name/context grounding as `click`. The stable planner prefix
  advertises only verbs the current backend can dispatch (cache-layout safe: constant
  within a run).
- **Chords** (`normalizeKeyChord`, `@rote/action`): zero or more of Alt/Control/Meta/Shift
  in canonical order plus exactly one allowlisted named key or single printable
  character. `ctrl`/`cmd` aliases normalize; anything else is a typed `KeyChordError` at
  schema-parse time — malformed planner output, never a dispatch.
- **Uploads**: planner actions carry `fileId` only. The injected allowlist
  (`AllowedUploadFile`) holds name/MIME/content; a missing id is a pre-dispatch typed
  failure naming allowlisted ids only. The CDP backend verifies file-input assignment in
  the same evaluation (dispatch-time strong effect — `element.files` is not capturable).
- **Drag**: standards HTML drag events with one shared `DataTransfer`; source and target
  must resolve into the same browsing context (`DragContextMismatchError` otherwise) and
  the source must be draggable (typed failure, never a silent click).
- **Safety**: every dispatched step records `classifyBrowserActionSafety` (hover=read,
  press/click=potentially_mutating, upload/dragAndDrop=mutating); an unclassified verb
  cannot dispatch.
- **Evidence**: new-verb DOM reactions are recorded but never enforced; declared
  authoritative outcomes remain with E7.4 evidence (#130).
- **Capability**: `BrowserPageSession`/`BrowserReplayPage` verbs are optional; a missing
  one is `BrowserCapabilityUnsupportedError` / `BROWSER_CAPABILITY_UNSUPPORTED` before
  side effects.

## Deterministic results

| Control | Result |
|---|---:|
| Real-Chrome repetitions (product verbs, exact frozen oracles) | 2/2 passed |
| E7-CONTROL-HOVER via `CdpPage.hover` + menu click | exact payload digest |
| E7-CONTROL-CHORD via `fill` + `press('Control+Enter')` | exact payload digest (text + chord) |
| E7-CONTROL-UPLOAD via allowlisted fixture bytes | exact content sha256 |
| E7-CONTROL-DRAG via shared-DataTransfer drag events | exact source-key digest |
| No-op control (unrelated DOM churn) | 0 additional authoritative events |
| Non-draggable drag source | typed failure, 0 events |
| Non-allowlisted / missing-allowlist upload | never dispatched; error names ids only |
| File name/content in recorded steps, errors, evidence | absent (asserted on serialized run) |
| Unnormalizable chord (`Hyper+Enter`, script suffix, `F13`) | typed rejection before dispatch |
| Backend without a verb | typed `BrowserCapabilityUnsupportedError`, no substitute event |
| Cross-context drag | typed `DragContextMismatchError`, 0 dispatches |
| Chord normalization idempotence | property-tested |

## Reproduce

```bash
npx vitest run packages/action/test/action-contract.test.ts \
  packages/agent/test/invariants/enterprise-verbs-fail-closed.test.ts
npm run test:enterprise-verbs-chrome --workspace @rote/bench   # requires Chrome/Chromium
```

CI runs the Chrome contract explicitly. Pointer-simulation drag fallback and
action-specific authoritative download capture remain open follow-ups; both fail typed
today rather than approximating.
