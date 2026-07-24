import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t hairline mt-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-8 py-12 grid gap-10 sm:grid-cols-3">
        <div>
          <p className="font-display text-xl">rote</p>
          <p className="mt-2 text-sm text-ink-2 max-w-[26ch]">
            The memory manager for browser agents. MIT licensed.
          </p>
          <p className="mt-4 font-mono text-[0.7rem] tracking-widest uppercase text-muted">
            No number, no launch.
          </p>
        </div>
        <div className="text-sm">
          <p className="eyebrow mb-3">Site</p>
          <ul className="space-y-2 text-ink-2">
            <li><Link className="hover:text-ink transition-colors" href="/architecture">Architecture</Link></li>
            <li><Link className="hover:text-ink transition-colors" href="/docs">Documentation</Link></li>
            <li><Link className="hover:text-ink transition-colors" href="/docs/benchmarks">Benchmarks &amp; runs</Link></li>
            <li><Link className="hover:text-ink transition-colors" href="/docs/packages">Packages</Link></li>
            <li><Link className="hover:text-ink transition-colors" href="/docs/roadmap">Roadmap</Link></li>
          </ul>
        </div>
        <div className="text-sm">
          <p className="eyebrow mb-3">Status</p>
          <p className="text-ink-2 max-w-[36ch]">
            Early build — P1, tier 0 (working memory). G1&apos;s
            working-memory curve passes at 37.2% slower logical-input growth;
            G2 and the launch package remain.
          </p>
        </div>
      </div>
    </footer>
  );
}
