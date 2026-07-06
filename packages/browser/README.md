# @rote/browser

Browser capture boundary for the P1/V1 efficiency-first browser-agent harness.
This first slice ships a deterministic static-HTML backend for fixture tests; the
next slice replaces the edge with a CDP local Chrome backend while preserving the
same `CapturedPage` shape.

## Public API

- `BrowserCaptureBackend` — minimal capture interface.
- `CapturedPage` / `CapturedElement` — Zod-backed page capture records.
- `StaticHtmlBackend` / `captureStaticHtml` — fixture backend used by P1 tests.

## Running tests

```bash
npm test --workspace @rote/browser
```
