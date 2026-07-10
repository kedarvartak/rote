# @rote/action

Browser action hardening for Rote's V1 harness. It provides deterministic settledness
and resilient semantic element resolution before dispatch.

## Public API

- `waitForSettled(probe, options)` — requires zero pending requests and an unchanged DOM mutation version for the configured quiet window.
- `SettlednessTimeoutError` — typed timeout carrying the last activity sample.
- `SettledBrowserPageSession` — wraps `navigate`, `fill`, `select`, and `click` with post-action settledness gates.
- `resolveElementTarget(nodes, target)` — resolves unique stable ID → unique role+name → unambiguous text proximity; selector-only legacy actions use their supplied selector.
- `ElementResolutionError` — typed failure when no actionable selector can be resolved.

Defaults: 250 ms quiet window, 50 ms polling, 5,000 ms timeout. `rote run` exposes the
timeout through `--settle-timeout-ms`.

## Running tests

```bash
npm test --workspace @rote/action
```
