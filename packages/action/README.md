# @rote/action

Browser action hardening for Rote's V1 harness. It provides deterministic settledness
resilient semantic element resolution before dispatch, and zero-LLM post-action evidence.

## Public API

- `waitForSettled(probe, options)` — requires zero pending requests and an unchanged DOM mutation version for the configured quiet window.
- `SettlednessTimeoutError` — typed timeout carrying the last activity sample.
- `SettledBrowserPageSession` — wraps `navigate`, `fill`, `select`, and `click` with post-action settledness gates; callers may declare a measured background-request floor while DOM quietness remains mandatory.
- `resolveElementTarget(nodes, target)` — resolves unique stable ID → unique role+name → unambiguous text proximity; selector-only legacy actions use their supplied selector, while semantic hints grounded to different rows fail before dispatch.
- `ElementResolutionError` / `ElementResolutionAmbiguityError` / `ElementResolutionContextMismatchError` / `ElementResolutionConflictError` — typed failures for an unresolvable target, residual collision, cross-context field splice before fuzzy matching, or stable-ID/role-name field splice.
- `evaluateBrowserExpect` / `assertBrowserExpect` — live checks for visible/absent selectors, input values, URL substrings, and visible text.
- `BrowserExpectationError` — typed model-authored postcondition failure carrying the assertion and page URL.
- `derivePostActionEvidence(input)` — compares settled before/after captures: fill/select values and canonical navigation targets are strong enforced effects; click DOM/URL changes are explicitly non-enforcing reaction evidence.
- `assertPostActionEvidence(evidence, pageUrl)` / `PostActionEvidenceError` — fail strong missing effects without copying dispatched values into evidence or error messages.

The frozen B2 drift suite covers selector renames, wrapper insertion, ambiguity,
stale-selector decoys, hidden replacements, and delayed SPA state.

Defaults: 250 ms quiet window, 50 ms polling, 5,000 ms timeout. `rote run` exposes the
timeout through `--settle-timeout-ms`.

## Running tests

```bash
npm test --workspace @rote/action
npm run test:identity-chrome --workspace @rote/action
```
