# @rote/web

The product website for Rote — a landing page telling the tier-0 story, an
architecture page built from `docs/02` (diagrams drawn natively in-site), and a docs section whose benchmark pages
render the real run reports (T10/G1, T11) with figures traced to

## Stack

Next.js 15 (App Router, all routes static) + Tailwind CSS v4. No other runtime
dependencies: charts are hand-rolled SVG components (`components/CurveChart.tsx`,
`components/CostChart.tsx`), scroll reveals use an IntersectionObserver
(`components/Reveal.tsx`), and the hero context-window animation is
`components/HeroDemo.tsx`. Fonts (Newsreader, IBM Plex Sans/Mono) are
self-hosted via `next/font`.

## Responsive contract

The site is read on phones, so two shared components carry the small-screen
rules — reach for them rather than re-solving these per page:

| Component | What it does |
| --- | --- |
| `components/DataTable.tsx` | Renders a table from `columns` + `rows`; below `sm` each row becomes a labelled card, so a five-column table never turns into a horizontal scroller that leaves its row label off screen. |
| `components/ScrollX.tsx` | Wraps content that genuinely cannot reflow (the charts). Adds edge fades on whichever side still has content, a hint that retires after the first scroll, and a keyboard-focusable scroll region. |

Everything else follows from three rules: interactive targets are at least
44px tall below `sm` (`min-h-11`), no element may set `touch-action: none` on
a full-width surface, and anything absolutely positioned inside a `ScrollX`
belongs outside it instead — the scroller is wider than the viewport.

## Run

```bash
cd web
npm install
npm run dev     # http://localhost:3000
npm run build   # static production build
```

Benchmark numbers on the site are hard-coded from the audited summaries in
`docs/testing/data/*.json` — if a report is re-run, update the data constants in
the two chart components and `app/docs/benchmarks/page.tsx`.
