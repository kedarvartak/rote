import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t hairline mt-32">
      <div className="mx-auto max-w-7xl px-6 sm:px-10 py-16">
        <div className="grid gap-12 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="w-2 h-2 rounded-full bg-copper" aria-hidden />
              <span className="display text-xl">rote</span>
            </div>
            <p className="mt-4 text-[0.95rem] text-ink-2 max-w-[30ch] leading-relaxed">
              The memory manager for browser agents. Budget, eviction, layout,
              and a trust gate on the way back in.
            </p>
          </div>
          <div className="text-[0.9rem]">
            <p className="eyebrow mb-4">Explore</p>
            <ul className="space-y-3">
              <li><Link className="text-ink-2 hover:text-ink transition-colors" href="/architecture">Architecture</Link></li>
              <li><Link className="text-ink-2 hover:text-ink transition-colors" href="/docs">Documentation</Link></li>
              <li><Link className="text-ink-2 hover:text-ink transition-colors" href="/docs/benchmarks">Benchmarks &amp; runs</Link></li>
              <li><Link className="text-ink-2 hover:text-ink transition-colors" href="/docs/packages">Packages</Link></li>
            </ul>
          </div>
          <div className="text-[0.9rem]">
            <p className="eyebrow mb-4">Status</p>
            <p className="text-ink-2 leading-relaxed max-w-[32ch]">
              Early build — P1, tier 0. The working-memory curve passes at 37.2%
              slower token growth. MIT licensed.
            </p>
          </div>
        </div>
        <div className="mt-14 pt-8 border-t hairline flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <p className="font-mono text-[0.7rem] tracking-[0.2em] uppercase text-ink-3">
            No number, no launch.
          </p>
          <p className="text-[0.8rem] text-ink-3">© 2026 Rote</p>
        </div>
      </div>
    </footer>
  );
}
