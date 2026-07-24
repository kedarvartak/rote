import type { Metadata } from "next";
import { CurveChart } from "@/components/CurveChart";
import { CostChart } from "@/components/CostChart";

export const metadata: Metadata = {
  title: "Benchmarks & runs — Rote",
  description:
    "G1's cumulative logical-input curve, the T11 cache-key economics, supporting measurements, and the honest losses — with receipts.",
};

const G1_ROWS = [
  { cell: "WP-N09", steps: 9, rote: "47,204", bu: "55,104", red: "14.3% [14.1–14.7]" },
  { cell: "WP-N13", steps: 13, rote: "51,068", bu: "68,455", red: "25.4% [25.0–25.7]" },
  { cell: "WP-N17", steps: 17, rote: "60,331", bu: "82,152", red: "26.6% [25.7–27.5]" },
  { cell: "WP-N21", steps: 21, rote: "69,476", bu: "95,888", red: "27.5% [26.6–28.5]" },
  { cell: "WP-N25", steps: 25, rote: "81,203", bu: "110,131", red: "26.3% [25.4–27.2]" },
];

const T11_ROWS = [
  { cell: "WP-N09", before: "$0.0193", after: "$0.0168", cut: "12.6% [1.7–24.6]", vsBu: "−15.0% [−29.4–1.3]", reads: "981 → 8,704" },
  { cell: "WP-N13", before: "$0.0193", after: "$0.0121", cut: "37.2% [22.2–49.7]", vsBu: "34.4% [20.2–46.5]", reads: "6,110 → 30,276" },
  { cell: "WP-N17", before: "$0.0235", after: "$0.0201", cut: "14.7% [2.3–27.2]", vsBu: "8.8% [−2.6–21.7]", reads: "5,649 → 16,503" },
  { cell: "WP-N21", before: "$0.0270", after: "$0.0236", cut: "12.6% [5.0–21.6]", vsBu: "8.3% [0.3–17.5]", reads: "6,707 → 18,790" },
  { cell: "WP-N25", before: "$0.0310", after: "$0.0246", cut: "20.5% [11.3–30.3]", vsBu: "16.0% [6.2–26.2]", reads: "10,377 → 29,722" },
];

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3.5 py-2.5 font-mono text-[0.62rem] uppercase tracking-widest text-muted font-normal text-left whitespace-nowrap">
      {children}
    </th>
  );
}

export default function BenchmarksPage() {
  return (
    <article className="pb-20 max-w-3xl">
      <p className="eyebrow">docs/03 · the evidence</p>
      <h1 className="mt-3 font-display wonk text-4xl tracking-tight">
        Benchmarks &amp; runs
      </h1>
      <p className="mt-5 text-ink-2 leading-relaxed">
        <span className="text-ink font-medium">No number, no launch.</span>{" "}
        Every claim below has a receipt: raw per-provider-call records for both
        harnesses live in{" "}
        <code className="font-mono text-[0.85em] text-copper-bright">
          docs/testing/data/
        </code>{" "}
        as JSON/JSONL, and each report documents its protocol. A number we
        cannot substantiate is not a number.
      </p>

      {/* methodology */}
      <h2 className="mt-12 font-display wonk text-2xl">Methodology</h2>
      <ul className="mt-4 space-y-2.5 text-[0.9rem] text-ink-2 leading-relaxed list-disc pl-5 marker:text-copper">
        <li>
          Baseline: <span className="text-ink">Browser Use 0.13.6</span>, the
          open-source default harness, on identical tasks and pages.
        </li>
        <li>
          Model: OpenAI <span className="font-mono text-[0.85em]">gpt-4.1-mini</span> for
          both harnesses; pricing dated 2026-07-15.
        </li>
        <li>
          Tasks: WordPress admin flows at five controlled lengths — WP-N09
          through WP-N25 (9 to 25 verified steps).
        </li>
        <li>
          <span className="text-ink">15 complete matched repetitions</span> per
          harness per cell; a cell only counts when its verify gate passes —
          75/75 verified successes per harness. Failed cells are never dropped.
        </li>
        <li>
          Intervals: 95% seeded-bootstrap CIs, 10,000 resamples.
        </li>
        <li>
          Metric: <span className="text-ink">logical input</span> = uncached
          input + cache reads + cache writes — so provider caching cannot
          masquerade as memory reduction.
        </li>
      </ul>

      {/* G1 */}
      <h2 className="mt-14 font-display wonk text-2xl" id="g1">
        T10 · Exit gate G1 — the cumulative-token curve{" "}
        <span className="font-mono text-sm text-good align-middle">PASS</span>
      </h2>
      <p className="mt-3 text-ink-2 leading-relaxed">
        The gate: cumulative tokens must grow materially slower with task
        length, against a public 30.0% floor. Result:{" "}
        <span className="text-ink">
          Rote&apos;s cumulative logical-input growth is 37.2% slower
        </span>{" "}
        than Browser Use, 95% CI 35.6–38.8%.
      </p>
      <div className="mt-6 rounded-sm border hairline bg-surface p-5">
        <CurveChart />
      </div>
      <div className="mt-5 overflow-x-auto rounded-sm border hairline">
        <table className="w-full text-[0.83rem]">
          <thead className="bg-surface border-b hairline">
            <tr>
              <Th>Cell</Th>
              <Th>Steps</Th>
              <Th>Rote logical input</Th>
              <Th>Browser Use</Th>
              <Th>Reduction [95% CI]</Th>
            </tr>
          </thead>
          <tbody className="divide-y hairline text-ink-2">
            {G1_ROWS.map((r) => (
              <tr key={r.cell} className="hover:bg-surface/70 transition-colors">
                <td className="px-3.5 py-2.5 font-mono text-ink">{r.cell}</td>
                <td className="px-3.5 py-2.5 tabular-nums">{r.steps}</td>
                <td className="px-3.5 py-2.5 tabular-nums text-copper-bright">{r.rote}</td>
                <td className="px-3.5 py-2.5 tabular-nums text-blue-bright">{r.bu}</td>
                <td className="px-3.5 py-2.5 tabular-nums">{r.red}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 font-mono text-[0.7rem] text-muted">
        source: docs/testing/T10-g1-cumulative-token-curve.md ·
        data/T10-g1-curve-summary.json
      </p>
      <div className="mt-5 rounded-sm border border-blue/30 bg-blue/5 p-5 text-[0.85rem] leading-relaxed text-ink-2">
        <p className="font-mono text-[0.65rem] uppercase tracking-widest text-blue-bright mb-2">
          honest caveat
        </p>
        In this frozen pre-cache-key matrix Rote was <i>not</i> cheaper: at
        WP-N25 its mean billed cost was 5.4% higher ($0.0310 vs $0.0294) and
        p50 latency 6.4% higher (72.0s vs 67.7s), because Browser Use received
        more discounted cache reads. That gap is what T11 was run to close.
      </div>

      {/* T11 */}
      <h2 className="mt-14 font-display wonk text-2xl" id="t11">
        T11 · Cache-key economics — the cost win
      </h2>
      <p className="mt-3 text-ink-2 leading-relaxed">
        One change: route a SHA-256 of the immutable prefix through OpenAI&apos;s{" "}
        <code className="font-mono text-[0.85em]">prompt_cache_key</code> — no
        added prompt text. At WP-N25 that cuts Rote&apos;s mean bill{" "}
        <span className="text-ink">20.5%</span> and makes it{" "}
        <span className="text-ink">16.0% cheaper than Browser Use</span>, while
        preserving ~37.6% slower logical growth.
      </p>
      <div className="mt-6 rounded-sm border hairline bg-surface p-5">
        <CostChart />
      </div>
      <div className="mt-5 overflow-x-auto rounded-sm border hairline">
        <table className="w-full text-[0.83rem]">
          <thead className="bg-surface border-b hairline">
            <tr>
              <Th>Cell</Th>
              <Th>Cost before</Th>
              <Th>After</Th>
              <Th>Cut [95% CI]</Th>
              <Th>vs Browser Use</Th>
              <Th>Cache reads</Th>
            </tr>
          </thead>
          <tbody className="divide-y hairline text-ink-2">
            {T11_ROWS.map((r) => (
              <tr key={r.cell} className="hover:bg-surface/70 transition-colors">
                <td className="px-3.5 py-2.5 font-mono text-ink">{r.cell}</td>
                <td className="px-3.5 py-2.5 tabular-nums">{r.before}</td>
                <td className="px-3.5 py-2.5 tabular-nums text-copper-bright">{r.after}</td>
                <td className="px-3.5 py-2.5 tabular-nums">{r.cut}</td>
                <td className="px-3.5 py-2.5 tabular-nums">{r.vsBu}</td>
                <td className="px-3.5 py-2.5 tabular-nums whitespace-nowrap">{r.reads}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 font-mono text-[0.7rem] text-muted">
        source: docs/testing/T11-cache-key-economics.md ·
        data/T11-cache-key-economics-summary.json
      </p>
      <p className="mt-4 text-ink-2 text-[0.9rem] leading-relaxed">
        WP-N09, the shortest cell, still loses on cost and its interval crosses
        parity — this is a long-task cache win, not a universal one.
      </p>

      {/* supporting */}
      <h2 className="mt-14 font-display wonk text-2xl">Supporting measurements</h2>
      <div className="mt-5 space-y-4">
        {[
          {
            id: "A4 · diff observations",
            body: "Across the G1 matrix, A4 emitted 849 diffs (median 24 chars) against 240 grounded bootstraps (median 9,270 chars) — a median render-size reduction of 99.6% relative to re-sending the page.",
            src: "T10-g1-cumulative-token-curve.md",
          },
          {
            id: "T2 · observation stability",
            body: "Real-page scale: WordPress /wp-admin/edit.php with 120 seeded posts and 100 rows per page — 6,784 captured elements distill to 797 nodes (787 actionable), 89,114 rendered chars ≈ 22,279 tokens, with zero measured variance across 15 repetitions.",
            src: "data/T2-wordpress-observation-stability.json",
          },
          {
            id: "T3 · OpenAI cache preflight",
            body: "86 measurement calls before the layout work: prompt tokens min 539 / median 806 / max 21,433; only 2 of 26 cache-eligible calls hit (7.7%). Decision: go do the layout work — which became B3 and T11.",
            src: "data/T3-openai-cache-preflight.json",
          },
          {
            id: "T1 · the false-negative lesson",
            body: "Fixture B2 went 0/7 to 11/11 on two models after making per-step expect optional — the harness was failing verified-correct runs on over-strict assertions. The bug became a test in the same PR (issues #49/#50).",
            src: "docs/02-architecture.md §Status",
          },
        ].map((m) => (
          <div key={m.id} className="rounded-sm border hairline bg-surface p-5">
            <p className="font-mono text-[0.72rem] text-copper-bright">{m.id}</p>
            <p className="mt-2 text-[0.87rem] text-ink-2 leading-relaxed">{m.body}</p>
            <p className="mt-2.5 font-mono text-[0.65rem] text-muted">source: docs/testing/{m.src.replace("docs/", "")}</p>
          </div>
        ))}
      </div>

      {/* gates */}
      <h2 className="mt-14 font-display wonk text-2xl">The two exit gates</h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-sm border border-good/40 bg-surface p-5">
          <div className="flex items-baseline justify-between">
            <p className="font-mono text-sm">G1 · the curve</p>
            <p className="font-mono text-[0.7rem] uppercase tracking-widest text-good">pass · 37.2%</p>
          </div>
          <p className="mt-2 text-[0.85rem] text-ink-2 leading-relaxed">
            Cumulative tokens grow materially slower with task length, ≥30%
            floor, CI-bounded.
          </p>
        </div>
        <div className="rounded-sm border hairline bg-surface p-5">
          <div className="flex items-baseline justify-between">
            <p className="font-mono text-sm">G2 · the level</p>
            <p className="font-mono text-[0.7rem] uppercase tracking-widest text-muted">not yet run</p>
          </div>
          <p className="mt-2 text-[0.85rem] text-ink-2 leading-relaxed">
            A tokens-per-task win at success parity, ≥15 runs, bootstrap lower
            bound above the floor. The launch package waits on it.
          </p>
        </div>
      </div>
    </article>
  );
}
