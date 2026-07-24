/**
 * The hero visual: one managed context window, drawn as a labeled instrument.
 * Segments mirror docs/02-architecture.md §The context assembler — immutable
 * prefix, action ledger growing ~37 tok/step, live tail arriving as a diff —
 * with the cache-stable line marked where mutation is forbidden. Pure CSS:
 * the ledger cells settle in once, left to right.
 */
const STEPS = ["navigate", "click", "fill", "click", "select", "fill", "click", "done"];

export function ContextStrip() {
  return (
    <div>
      <div className="rounded-sm border hairline bg-surface/80 p-2 flex flex-col sm:flex-row gap-2 sm:gap-px sm:items-stretch">
        {/* immutable prefix — nothing above the line may mutate */}
        <div className="sm:w-[24%] shrink-0 rounded-[3px] border border-dashed border-copper/45 bg-copper/[0.06] px-4 py-3.5">
          <p className="font-mono text-[0.66rem] tracking-widest uppercase text-copper-bright">
            immutable prefix
          </p>
          <p className="mt-1 font-mono text-[0.62rem] text-muted leading-relaxed">
            system · task · tools — ~268 tok, cached via prompt_cache_key
          </p>
        </div>

        {/* action ledger — what survives eviction */}
        <div className="flex-1 rounded-[3px] bg-surface-2/60 px-4 py-3.5 min-w-0">
          <div className="flex items-baseline justify-between gap-4">
            <p className="font-mono text-[0.66rem] tracking-widest uppercase text-ink-2">
              action ledger
            </p>
            <p className="font-mono text-[0.62rem] text-muted">+~37 tok/step</p>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {STEPS.map((s, i) => (
              <span
                key={i}
                className="cell-pop rounded-[2px] border border-copper/35 bg-copper/15 text-copper-bright font-mono text-[0.62rem] px-2 py-0.5"
                style={{ animationDelay: `${0.9 + i * 0.22}s` }}
              >
                {s}
              </span>
            ))}
          </div>
        </div>

        {/* live tail — the only observation in the window */}
        <div className="sm:w-[21%] shrink-0 rounded-[3px] border border-blue/30 bg-blue/[0.07] px-4 py-3.5">
          <p className="font-mono text-[0.66rem] tracking-widest uppercase text-blue-bright">
            live page
          </p>
          <p className="mt-1 font-mono text-[0.62rem] text-muted leading-relaxed">
            full once, then diffs — median 24 chars
          </p>
        </div>
      </div>

      {/* the line and what fell out of the window */}
      <div className="mt-2.5 px-1 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
        <p className="font-mono text-[0.62rem] tracking-[0.18em] uppercase text-copper-bright/90">
          ▲ cache-stable · nothing above the line may mutate
        </p>
        <p className="font-mono text-[0.62rem] tracking-[0.18em] uppercase text-muted">
          evicted: every stale observation — the quadratic term
        </p>
      </div>
    </div>
  );
}
