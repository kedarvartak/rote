# @rote/browser

Browser capture boundary for the V1 efficiency-first browser-agent harness.
It defines the page-capture shape consumed by perception and ships both a deterministic
static-HTML backend for fixture tests and a minimal Chrome DevTools Protocol backend for
live local pages.

In the full system, this package is the I/O edge for the perception plane: browser state
comes in here, then `@rote/perception` turns it into compact observations for the agent.

## Public API

- `BrowserCaptureBackend` — minimal capture interface.
- `CapturedPage` / `CapturedElement` — Zod-backed page capture records; static and CDP captures attach hashed, allowlisted top-level container lineage for identity v2 without copying control values into identity.
- `StaticHtmlBackend` / `captureStaticHtml` — fixture backend with associated-label/`aria-labelledby` accessibility enrichment.
- `CdpBrowserBackend` — captures from an existing CDP HTTP endpoint.
- `LaunchingCdpBrowserBackend` — launches local Chrome/Chromium with CDP enabled, an optional deterministic window size, stateful action sessions, and clean shutdown.
- `CdpPage` — stateful CDP page session with navigation/actions, composed capture through nested same/cross-origin frames and open shadow roots, correctly aligned live visibility, context-local selectors, stale-document checks before dispatch, form/checked-state capture, top-level same-tab link recovery, and network/DOM activity sampling. E7.5 verbs (#131): `hover` (grounded pointer/mouse enter sequence), `press` (pre-normalized chord as real keyboard events, never evaluated strings), `upload` (in-page `File` assignment verified in the same evaluation; content transits only the call), and `dragAndDrop` (standards drag events with one shared `DataTransfer`; non-draggable sources fail typed).
- `captureStaticHtml` — preserves nested screen-reader label text as the associated control's accessible name.
- `BrowserContextCoordinateSchema` / `browserContextCoordinate` — versioned durable frame/shadow paths plus fresh document tokens; runtime CDP IDs never enter identity.
- `BrowserContextMismatchError` / `BrowsingContextStaleError` / `ClosedShadowRootUnsupportedError` — fail-closed context boundaries.
- `FixtureSiteServer` — serves static fixture pages from a local directory for deterministic CDP tests.

`LaunchingCdpBrowserBackend` uses `CHROME_PATH` when set, otherwise probes common local
Chrome/Chromium paths. Its explicit `ws` transport keeps CDP available on supported Node
20 releases that do not expose a global `WebSocket`, and shutdown waits for Chromium
before removing its profile. The broad browser-package CDP integration test remains
opt-in; E7.1 separately runs its frozen enterprise fixture smoke in mandatory CI:

```bash
ROTE_RUN_CDP_TESTS=1 npm test --workspace @rote/browser
npm run test:enterprise-chrome --workspace @rote/bench
```

## Running tests

```bash
npm test --workspace @rote/browser
```

Run the live local CDP fixture coverage when Chrome/Chromium is available:

```bash
ROTE_RUN_CDP_TESTS=1 npm test --workspace @rote/browser
```
