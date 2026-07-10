# @rote/action

Browser action hardening for Rote's V1 harness. The first slice provides deterministic
settledness detection and a page-session decorator that waits after every navigation or
mutating browser action.

## Public API

- `waitForSettled(probe, options)` — requires zero pending requests and an unchanged DOM mutation version for the configured quiet window.
- `SettlednessTimeoutError` — typed timeout carrying the last activity sample.
- `SettledBrowserPageSession` — wraps `navigate`, `fill`, `select`, and `click` with post-action settledness gates.

Defaults: 250 ms quiet window, 50 ms polling, 5,000 ms timeout. `rote run` exposes the
timeout through `--settle-timeout-ms`.

## Running tests

```bash
npm test --workspace @rote/action
```
