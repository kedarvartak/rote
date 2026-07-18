# @rote/action

Browser action hardening for Rote's V1 harness. It provides deterministic settledness
and resilient semantic element resolution before dispatch.

## Public API

- `waitForSettled(probe, options)` — requires zero pending requests and an unchanged DOM mutation version for the configured quiet window.
- `SettlednessTimeoutError` — typed timeout carrying the last activity sample.
- `SettledBrowserPageSession` — wraps `navigate`, `fill`, `select`, and `click` with post-action settledness gates; callers may declare a measured background-request floor while DOM quietness remains mandatory.
- `resolveElementTarget(nodes, target)` — resolves unique stable ID → unique role+name → unambiguous text proximity; selector-only legacy actions use their supplied selector.
- `ElementResolutionError` — typed failure when no actionable selector can be resolved.
- `evaluateBrowserExpect` / `assertBrowserExpect` — live checks for visible/absent selectors, input values, URL substrings, and visible text.
- `BrowserExpectationError` — typed postcondition failure carrying the assertion and page URL.

The frozen B2 drift suite covers selector renames, wrapper insertion, ambiguity,
stale-selector decoys, hidden replacements, and delayed SPA state.

Defaults: 250 ms quiet window, 50 ms polling, 5,000 ms timeout. `rote run` exposes the
timeout through `--settle-timeout-ms`.

## Running tests

```bash
npm test --workspace @rote/action
```
