import Link from "next/link";

export function Footer() {
  return (
    <footer className="relative">
      {/* horizon glow — strongest at the footer line, fading up into the page */}
      <div
        aria-hidden
        className="pointer-events-none h-40 -mb-px"
        style={{
          background:
            "radial-gradient(ellipse 95% 140% at 50% 100%, rgba(194,117,31,0.26), rgba(194,117,31,0.07) 52%, transparent 78%)",
        }}
      />
      <div
        aria-hidden
        className="h-1.5"
        style={{
          background:
            "repeating-linear-gradient(45deg, rgba(217,143,61,0.3) 0 5px, transparent 5px 10px)",
        }}
      />
      <div className="border-t hairline bg-surface/40">
      <div className="mx-auto max-w-6xl px-5 sm:px-8 py-14">
        <div className="grid gap-10 md:grid-cols-[1.3fr_1fr_1fr]">
          <div>
            <p className="font-display text-2xl tracking-tight">rote</p>
            <p className="mt-3 text-sm text-ink-2 leading-relaxed max-w-[30ch]">
              The memory manager for browser agents — a budget, an eviction
              policy, a layout contract, and a trust gate on the way back in.
            </p>
          </div>
          <div className="text-sm">
            <p className="eyebrow mb-3.5">Explore</p>
            <ul className="space-y-2.5 text-ink-2">
              <li><Link className="hover:text-copper-bright transition-colors" href="/architecture">Architecture</Link></li>
              <li><Link className="hover:text-copper-bright transition-colors" href="/docs">Documentation</Link></li>
              <li><Link className="hover:text-copper-bright transition-colors" href="/docs/packages">Packages</Link></li>
              <li><Link className="hover:text-copper-bright transition-colors" href="/docs/roadmap">Roadmap</Link></li>
            </ul>
          </div>
          <div className="text-sm">
            <p className="eyebrow mb-3.5">Evidence</p>
            <ul className="space-y-2.5 text-ink-2">
              <li><Link className="hover:text-copper-bright transition-colors" href="/docs/benchmarks">Benchmarks &amp; runs</Link></li>
              <li><Link className="hover:text-copper-bright transition-colors" href="/docs/benchmarks#g1">G1 · the curve — pass</Link></li>
              <li><Link className="hover:text-copper-bright transition-colors" href="/docs/benchmarks#t11">T11 · cache-key economics</Link></li>
            </ul>
            <p className="mt-4 text-[0.8rem] text-muted leading-relaxed max-w-[30ch]">
              Early build — P1, tier 0. G1 passes at 37.2% slower
              logical-input growth; G2 remains.
            </p>
          </div>
        </div>
        <div className="mt-12 pt-6 border-t hairline flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <p className="text-[0.8rem] text-muted">
            © 2026 Rote · MIT licensed
          </p>
          <p className="font-mono text-[0.68rem] tracking-[0.15em] uppercase text-muted">
            the memory manager for browser agents
          </p>
        </div>
      </div>
      </div>
    </footer>
  );
}
