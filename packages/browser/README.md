# @rote/browser

Browser capture boundary for the V1 efficiency-first browser-agent harness.
It defines the page-capture shape consumed by perception and ships both a deterministic
static-HTML backend for fixture tests and a minimal Chrome DevTools Protocol backend for
live local pages.

In the full system, this package is the I/O edge for the perception plane: browser state
comes in here, then `@rote/perception` turns it into compact observations for the agent.

## Public API

- `BrowserCaptureBackend` — minimal capture interface.
- `CapturedPage` / `CapturedElement` — Zod-backed page capture records.
- `StaticHtmlBackend` / `captureStaticHtml` — fixture backend used by P1 tests.
- `CdpBrowserBackend` — captures from an existing CDP HTTP endpoint.
- `LaunchingCdpBrowserBackend` — launches local Chrome/Chromium with CDP enabled, captures a page, opens stateful action sessions, and closes cleanly.
- `CdpPage` — stateful CDP page session with `navigate`, `capture`, `fill`, `select`, `click`, and `evaluate`.
- `FixtureSiteServer` — serves static fixture pages from a local directory for deterministic CDP tests.

`LaunchingCdpBrowserBackend` uses `CHROME_PATH` when set, otherwise probes common local
Chrome/Chromium paths. The CDP integration test is opt-in because hosted CI images may
ship Chrome variants that do not expose DevTools reliably:

```bash
ROTE_RUN_CDP_TESTS=1 npm test --workspace @rote/browser
```

## Running tests

```bash
npm test --workspace @rote/browser
```

Run the live local CDP fixture coverage when Chrome/Chromium is available:

```bash
ROTE_RUN_CDP_TESTS=1 npm test --workspace @rote/browser
```
