# @rote/web

The product website for Rote — a landing page telling the tier-0 story, an
architecture page built from `docs/02`, and a docs section whose benchmark pages
render the real run reports (T10/G1, T11) with figures traced to
`docs/testing/data/`. Diagrams under `public/diagrams/` are copied from
`docs/diagrams/`; re-copy them when the source SVGs regenerate.

## Stack

Next.js 15 (App Router, all routes static) + Tailwind CSS v4. No other runtime
dependencies. The design is minimal and type-forward; all motion lives in the
background:

- `components/MemoryField.tsx` — the signature: a generative canvas field of
  memory cells lit by two slow-orbiting lights (the product metaphor as ambient
  motion). Pure canvas + rAF; DPR-aware, pauses when hidden, renders one static
  frame under `prefers-reduced-motion`.
- `components/CurveChart.tsx` / `CostChart.tsx` — hand-rolled SVG charts with
  hover tooltips.
- `components/HeroLedger.tsx` — the live append-vs-managed context demo.
- `components/Reveal.tsx` / `CountUp.tsx` — restrained scroll reveals and
  count-up figures, all reduced-motion safe.

Fonts (Space Grotesk display, Inter body, IBM Plex Mono) are self-hosted via
`next/font`.

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
