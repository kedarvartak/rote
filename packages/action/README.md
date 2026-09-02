# @rote/action

Browser action hardening for Rote's V1 harness. It provides deterministic settledness
resilient semantic element resolution before dispatch, and zero-LLM post-action evidence.

## Speculation fence (P3, refusal only)

`classifySpeculation(input)` answers one question about an already-derived action
contract: how far could running this action *early* reach? It returns one of docs/02's
effect classes — `pure_read`, `local_nav`, `local_write`, `external_effect` — with the
rule that produced it, and it is total: staleness, target ambiguity and unmet
preconditions are checked before the verb, a posting form outranks its controls, and any
verb, control or destination without an explicit rule is an `external_effect`.

`maySpeculate(verdict, policy)` applies a policy on top. The default permits `pure_read`
alone (P3.2 prefetches observations); `local_nav` becomes eligible in P3.3 behind a
discardable shadow context. `external_effect` is never permitted, and a policy that names
it throws rather than being silently ignored.

Nothing here dispatches, predicts, or opens a context — the fence is built before the
mechanism it will fence, and it is inert until a speculation mechanism consults it.

## Public API

- `waitForSettled(probe, options)` — requires unanswered requests within `maxPendingRequests` (default 0) and unchanged DOM mutation and network-activity versions for the configured quiet window; the wait is bounded by `timeoutMs`. Probes may report `networkVersion` so an actively streaming background body keeps the page unsettled even though it is no longer pending (#132).
- `SettlednessTimeoutError` — typed timeout carrying the last activity sample.
- `SettledBrowserPageSession` — wraps `navigate`, `fill`, `select`, and `click` with post-action settledness gates; callers may declare a measured background-request floor while DOM quietness remains mandatory, and an optional `onSettle` sink receives each bounded settle's verb and elapsed milliseconds (timed-out settles throw and are never reported as costs).
- `resolveElementTarget(nodes, target)` — resolves unique stable ID → unique role+name → unambiguous text proximity; selector-only legacy actions use their supplied selector, while semantic hints grounded to different rows fail before dispatch.
- `deriveActionContract({ verb, node })` / `assertActionContract(recorded, current)` / `deriveActionSafety` — #143 gate: a strict, value-free `ActionContract` for the resolved live node (identity/context, affordance from the node's capture-time facts, safety refined by what the control does — link/GET submit `navigation`, POST submit `mutating`, checkbox `local_input`), compared with the recorded one via the core matrix; incompatibility is `ActionContractMismatchError` (`classification: 'contract_mismatch'`, `dispatched: false`) before any backend call; a node without affordance is `ActionContractUnavailableError`.
- `ElementResolutionError` / `ElementResolutionAmbiguityError` / `ElementResolutionContextMismatchError` / `ElementResolutionConflictError` / `ElementResolutionStaleIdentityError` — typed failures for an unresolvable target, residual collision, cross-context field splice before fuzzy matching, stable-ID/role-name field splice, or (raised by the agent loop, #132) an already-dispatched identity that vanished on remount and would only rebind by fuzzy text/selector.
- `evaluateBrowserExpect` / `assertBrowserExpect` — live checks for visible/absent selectors, input values, URL substrings, and visible text.
- `BrowserExpectationError` — typed model-authored postcondition failure carrying the assertion and page URL.
- `derivePostActionEvidence(input)` — compares settled before/after captures: fill/select values and canonical navigation targets are strong enforced effects; click DOM/URL changes are explicitly non-enforcing reaction evidence.
- `assertPostActionEvidence(evidence, pageUrl)` / `PostActionEvidenceError` — fail strong missing effects without copying dispatched values into evidence or error messages.
- `normalizeKeyChord(input)` / `KeyChordError` — canonical explicit chords (sorted Alt/Control/Meta/Shift + one allowlisted key); anything else fails typed before dispatch — chords are never arbitrary script (#131).
- `classifyBrowserActionSafety(kind)` — versioned E7.5 safety classes (hover=read … upload/dragAndDrop=mutating); unclassified verbs cannot dispatch.
- `AllowedUploadFileSchema` / `UploadNotAllowlistedError` — injected id-referenced upload allowlist; failures name ids only, never file names, paths, or content.
- `BrowserCapabilityUnsupportedError` / `DragContextMismatchError` — typed exits for a backend missing a verb and for cross-context drag.
- `SettledBrowserPageSession` also gates the optional `hover`/`press`/`upload`/`dragAndDrop` verbs when the wrapped page provides them.

The frozen B2 drift suite covers selector renames, wrapper insertion, ambiguity,
stale-selector decoys, hidden replacements, and delayed SPA state.

Defaults: 250 ms quiet window, 50 ms polling, 5,000 ms timeout. `rote run` exposes the
timeout through `--settle-timeout-ms`.

## Running tests

```bash
npm test --workspace @rote/action
npm run test:identity-chrome --workspace @rote/action
```
