# @rote/web

The product website for Rote — a landing page telling the tier-0 story, an
architecture page built from `docs/02` (diagrams drawn natively in-site), and a docs section whose benchmark pages
render the real run reports (T10/G1, T11) with figures traced to

## Stack

Next.js 15 (App Router, all routes static) + Tailwind CSS v4. No other runtime
dependencies: charts are hand-rolled SVG components (`components/CurveChart.tsx`,
`components/CostChart.tsx`), scroll reveals use an IntersectionObserver
(`components/Reveal.tsx`), and the hero context-window animation is
`components/HeroLedger.tsx`. Fonts (Newsreader, IBM Plex Sans/Mono) are
self-hosted via `next/font`.

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
