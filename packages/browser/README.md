# @rote/browser

Browser capture boundary for the V1 efficiency-first browser-agent harness.
It defines the page-capture shape consumed by perception and ships a deterministic
static-HTML backend for fixture tests. The next implementation slice replaces the
capture edge with a CDP local Chrome backend while preserving the same `CapturedPage`
contract.

In the full system, this package is the I/O edge for the perception plane: browser state
comes in here, then `@rote/perception` turns it into compact observations for the agent.

## Public API

- `BrowserCaptureBackend` — minimal capture interface.
- `CapturedPage` / `CapturedElement` — Zod-backed page capture records.
- `StaticHtmlBackend` / `captureStaticHtml` — fixture backend used by P1 tests.

## Running tests

```bash
npm test --workspace @rote/browser
```
