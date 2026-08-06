import type { Metadata } from "next";
import Link from "next/link";
import { DataTable } from "@/components/DataTable";

const AMNESIAS = [
  {
    tier: "0 · Working",
    scope: "within one run",
    bill: "cost is O(n²) in task length",
    status: "built · measured (G1 pass)",
    good: true,
  },
  {
    tier: "1 · Episodic",
    scope: "across runs of a task",
    bill: "run #50 costs what run #1 cost",
    status: "replay built · distiller unbuilt (P2)",
    good: false,
  },
  {
    tier: "2 · Semantic",
    scope: "across tasks on a site",
    bill: "every task re-learns the portal",
    status: "designed (P2)",
    good: false,
  },
];

export const metadata: Metadata = {
  description:
    "What Rote is, the three amnesias it fixes, the trust gate, and where to find the run reports.",
};

export default function DocsOverview() {
  return (
    <article className="pb-20 max-w-3xl">
      <p className="eyebrow">overview</p>
      <h1 className="mt-3 font-display text-4xl tracking-tight">What Rote is</h1>

      <div className="mt-6 space-y-5 text-ink-2 leading-relaxed">
        <p>
          <span className="text-ink font-medium">
            Rote is the memory manager for browser agents.
          </span>{" "}
          Agent harnesses all have memory — history arrays, screenshot piles,
          selector caches. What none of them has is a manager: something
          that decides what stays in the context window, what leaves, what
          comes back, and what has to be proven before it's trusted. The
          window is treated as a garbage dump — append, and hope. Rote treats
          it as a managed resource: a budget, an eviction policy, a layout
          contract, and a trust gate on the way back in.
        </p>
        <p>
          The name is the thesis. Rote: doing something from memory, by
          repetition, without re-deriving it. Technically, it is memoization
          applied to agent trajectories — cache the result of expensive
          exploration, keyed by task class and environment fingerprint,
          invalidated by assertion rather than TTL.
        </p>
      </div>

      <h2 className="mt-12 font-display text-2xl">The three amnesias</h2>
      <DataTable
        className="mt-4"
        label="The three amnesias"
        rows={AMNESIAS}
        rowKey={(r) => r.tier}
        columns={[
          { header: "Tier", cell: (r) => r.tier, card: "title", className: "text-ink whitespace-nowrap" },
          { header: "Scope", cell: (r) => r.scope },
          { header: "The bill", cell: (r) => r.bill },
          {
            header: "Status",
            cell: (r) => (
              <span className={r.good ? "text-good" : undefined}>{r.status}</span>
            ),
          },
        ]}
      />
      <p className="mt-4 text-ink-2 leading-relaxed">
        The trust gate is not a fourth tier — it is the precondition for all
        three. Memory that might be wrong is worse than no memory: every tier
        is assertion-gated on the way back in, and success is decided by page
        state, never by the absence of an exception.
      </p>

      <h2 className="mt-12 font-display text-2xl">Try it</h2>
      <p className="mt-3 text-ink-2 leading-relaxed">
        The <code className="font-mono text-[0.85em] text-copper-bright">rote</code>{" "}
        CLI launches verified cold browser tasks and prefers exact-fingerprint,
        zero-LLM replay when a recorded candidate matches. (Pre-release: the
        packages are unpublished at 0.0.0 — build from source.)
      </p>
      <pre className="mt-4 rounded-sm border hairline bg-surface p-5 overflow-x-auto font-mono text-[0.8rem] leading-relaxed text-ink-2">
        <code>{`# run a task cold, with a verify gate — success is page state, not vibes
rote run "create a tag named release-notes" \\
  --url http://localhost:8080/wp-admin \\
  --verify-text "release-notes"

# inspect what was recorded
rote runs ls
rote runs show <run_id>

# promote a verified run into a replay candidate
rote candidate create`}</code>
      </pre>

      <h2 className="mt-12 font-display text-2xl">Where to go next</h2>
      <ul className="mt-4 space-y-3">
        {[
          { href: "/architecture", title: "Architecture", body: "The memory spine, the control loop, the context assembler, the repair ladder." },
          { href: "/docs/benchmarks", title: "Benchmarks & runs", body: "G1's cumulative-token curve, the cache-key economics, and every honest caveat." },
          { href: "/docs/packages", title: "Packages", body: "The ten-package monorepo, from zero-I/O core to the CLI." },
          { href: "/docs/roadmap", title: "Roadmap & status", body: "P0 → P5, the exit gates, and exactly what is not built yet." },
        ].map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className="block rounded-sm border hairline bg-surface p-4 hover:border-copper/50 transition-colors group"
            >
              <span className="font-medium group-hover:text-copper-bright transition-colors">
                {l.title} →
              </span>
              <span className="block mt-1 text-[0.85rem] text-ink-2">{l.body}</span>
            </Link>
          </li>
        ))}
      </ul>
    </article>
  );
}
