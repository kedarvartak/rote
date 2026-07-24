import Link from "next/link";
import { HeroLedger } from "@/components/HeroLedger";
import { CurveChart } from "@/components/CurveChart";
import { CostChart } from "@/components/CostChart";
import { Reveal } from "@/components/Reveal";
import { CountUp } from "@/components/CountUp";

const B2 = [637, 677, 716, 759, 800, 839, 876, 917, 953];

const TIERS = [
  {
    id: "0",
    name: "Working",
    scope: "within one run",
    line: "It forgets what it already sent this run — so cost grows with the square of task length.",
    status: "Built · measured",
    live: true,
  },
  {
    id: "1",
    name: "Episodic",
    scope: "across runs of a task",
    line: "It forgets the procedure that worked yesterday — so run #50 costs what run #1 cost.",
    status: "Designed · P2",
    live: false,
  },
  {
    id: "2",
    name: "Semantic",
    scope: "across tasks on a site",
    line: "It forgets how the site behaves at all — so every task re-learns the portal.",
    status: "Designed · P2",
    live: false,
  },
];

const LEVERS = [
  { tag: "A11", name: "Observation eviction", line: "Prior observations leave the window; the action ledger stays. Growth falls from ~172 to ~37 tokens per step.", status: "Built" },
  { tag: "A4", name: "Diff observations", line: "After a grounded bootstrap, each step sends only a diff — median 24 chars, 99.6% smaller than a re-send.", status: "Built" },
  { tag: "B3", name: "Cache-layout discipline", line: "Nothing above the stable line may mutate, so the immutable prefix bills at the discounted cache rate.", status: "Built" },
  { tag: "B4", name: "History compaction", line: "Summarize the far tail under budget — the one lever that turns the curve from quadratic to linear.", status: "Deferred to P2" },
];

const INVARIANTS = [
  { name: "Never silently wrong", body: "No path reports success when a verify or expect check failed. Success is decided by page state, never by the absence of an exception." },
  { name: "Never worse than baseline", body: "Fallback to the plain agent is always reachable and clean. A miss costs one cheap match call, and the fallback logs why it fired." },
  { name: "Never cross environments", body: "A structural fingerprint is a hard gate before any fuzzy matching. A playbook learned on staging can't fire on prod." },
  { name: "Everything versioned", body: "Store mutations are append-only. Playbooks and repair patches are auditable, diffable, exportable as human-readable YAML." },
  { name: "Every model call tagged", body: "All usage flows through one client wrapper with a source tag. Untagged calls fail lint." },
];

const PHASES = [
  { id: "P0", theme: "Foundations", line: "recorder, verified replay, invariant suite", state: "done" },
  { id: "P1", theme: "Working memory", line: "the first browser agent with a managed context window", state: "here" },
  { id: "P2", theme: "The harness that learns", line: "your 50th task on a site costs a fraction of your 1st", state: "next" },
  { id: "P3", theme: "Speculation", line: "warm flows bounded by think-time only", state: "later" },
  { id: "P4", theme: "Fleet & enterprise", line: "10K tasks a day, audited, lowest cost per task", state: "later" },
  { id: "P5", theme: "Platform", line: "the efficiency substrate other agents build on", state: "later" },
];

/** Editorial section shell: a narrow sticky label column beside spacious content. */
function Section({
  label,
  index,
  children,
  className = "",
}: {
  label: string;
  index: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`mx-auto max-w-7xl px-6 sm:px-10 py-24 sm:py-36 ${className}`}>
      <div className="grid gap-10 lg:grid-cols-[15rem_1fr]">
        <Reveal className="lg:sticky lg:top-28 self-start">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[0.7rem] text-copper">{index}</span>
            <span className="eyebrow">{label}</span>
          </div>
          <div className="rule mt-5 w-full max-w-[10rem]" aria-hidden />
        </Reveal>
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <div>
      {/* ───────────────────────────────────────────── hero */}
      <section className="relative mx-auto max-w-7xl px-6 sm:px-10 pt-20 sm:pt-32 pb-24">
        <p className="eyebrow settle" style={{ animationDelay: "0.1s" }}>
          Memory manager · browser agents
        </p>
        <h1 className="display mt-8 text-[3rem] sm:text-[5.5rem] leading-[0.98] max-w-[16ch]">
          <span className="settle inline-block" style={{ animationDelay: "0.2s" }}>
            Every harness
          </span>{" "}
          <span className="settle inline-block" style={{ animationDelay: "0.35s" }}>
            has memory.
          </span>
          <br />
          <span
            className="settle inline-block text-ink-2"
            style={{ animationDelay: "0.6s" }}
          >
            None manages it.
          </span>
        </h1>
        <div
          className="settle max-w-xl mt-10"
          style={{ animationDelay: "0.9s" }}
        >
          <p className="text-lg text-ink-2 leading-relaxed">
            Browser agents treat the context window as a garbage dump — append,
            and hope. Rote manages it: a budget, an eviction policy, a layout
            contract, and a trust gate on the way back in.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-7">
            <Link
              href="/docs/benchmarks"
              className="pill rounded-full bg-ink text-bg text-sm font-medium px-6 py-3 hover:bg-copper hover:text-bg"
            >
              See the numbers
            </Link>
            <Link href="/architecture" className="ulink text-sm text-ink-2 hover:text-ink">
              Read the architecture →
            </Link>
          </div>
        </div>

        {/* quiet stat strip */}
        <div
          className="settle mt-24 grid grid-cols-2 sm:grid-cols-4 gap-y-10 gap-x-8 border-t hairline pt-10"
          style={{ animationDelay: "1.1s" }}
        >
          {[
            { v: <CountUp to={37.2} decimals={1} suffix="%" />, l: "slower token growth" },
            { v: <><CountUp to={75} />/75</>, l: "verified successes" },
            { v: <CountUp to={99.6} decimals={1} suffix="%" />, l: "smaller observations" },
            { v: <CountUp to={20.5} decimals={1} suffix="%" />, l: "cost cut at 25 steps" },
          ].map((s, i) => (
            <div key={i}>
              <div className="display text-4xl sm:text-5xl tabular-nums text-ink">
                {s.v}
              </div>
              <div className="mt-2 text-[0.8rem] text-ink-2">{s.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ───────────────────────────────────────────── the quadratic */}
      <Section label="The problem" index="01" className="border-t hairline">
        <Reveal>
          <h2 className="display text-4xl sm:text-6xl leading-[1.02] max-w-[13ch]">
            Everyone lowers the constant.
          </h2>
          <p className="display text-4xl sm:text-6xl leading-[1.02] max-w-[13ch] text-ink-2 mt-2">
            Nobody touches the exponent.
          </p>
        </Reveal>
        <Reveal delay={100}>
          <p className="mt-10 text-lg text-ink-2 leading-relaxed max-w-2xl">
            A run of <i>n</i> steps re-sends its whole history every step:
            1 + 2 + … + <i>n</i> prompt-units. Cost is quadratic in task length.
            Compression shrinks the per-step prompt — it lowers the constant,
            not the exponent.
          </p>
        </Reveal>
        <Reveal delay={150}>
          <div className="mt-14 max-w-2xl">
            <div className="flex items-baseline justify-between mb-5">
              <span className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-ink-3">
                fixture B2 · input tokens per call
              </span>
              <span className="font-mono text-sm text-copper">+38%</span>
            </div>
            <div className="flex items-end gap-2 h-28">
              {B2.map((t, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-2">
                  <div
                    className="w-full bg-ink-2/25"
                    style={{ height: `${(t / 953) * 100}%` }}
                  />
                  <span className="font-mono text-[0.6rem] text-ink-3 tabular-nums">
                    {t}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-6 text-[0.95rem] text-ink-2 leading-relaxed">
              21% of that run&apos;s input bill is re-reading text it already
              sent — on a page that distills to ten nodes.
            </p>
          </div>
        </Reveal>
      </Section>

      {/* ───────────────────────────────────────────── the policy / live demo */}
      <Section label="The policy" index="02" className="border-t hairline">
        <Reveal>
          <h2 className="display text-4xl sm:text-6xl leading-[1.02] max-w-[15ch]">
            Keep what you did, not what you saw.
          </h2>
          <p className="mt-10 text-lg text-ink-2 leading-relaxed max-w-2xl">
            The action ledger survives — about 37 tokens a step. Stale
            observations leave the window, and the current page arrives as a
            diff against the last grounded bootstrap. Two windows running the
            same task, one appending, one managed:
          </p>
        </Reveal>
        <Reveal delay={120}>
          <div className="mt-14">
            <HeroLedger />
          </div>
        </Reveal>
      </Section>

      {/* ───────────────────────────────────────────── three tiers */}
      <Section label="The spine" index="03" className="border-t hairline">
        <Reveal>
          <h2 className="display text-4xl sm:text-6xl leading-[1.02] max-w-[14ch]">
            Three amnesias. Three tiers.
          </h2>
          <p className="mt-8 text-lg text-ink-2 leading-relaxed max-w-2xl">
            Browser agents forget at three timescales and pay again at every
            one. Rote manages each — and every tier is assertion-gated on the
            way back in, because memory that might be wrong is worse than no
            memory.
          </p>
        </Reveal>
        <div className="mt-16 border-t hairline">
          {TIERS.map((t, i) => (
            <Reveal key={t.id} delay={i * 90}>
              <div className="grid grid-cols-[3rem_1fr] sm:grid-cols-[4rem_9rem_1fr_auto] gap-x-5 gap-y-2 items-baseline py-8 border-b hairline group">
                <span className="display text-3xl text-ink-3 group-hover:text-copper transition-colors duration-500">
                  {t.id}
                </span>
                <div>
                  <div className="display text-xl text-ink">{t.name}</div>
                  <div className="font-mono text-[0.7rem] text-ink-3 mt-1">{t.scope}</div>
                </div>
                <p className="col-span-2 sm:col-span-1 text-[0.98rem] text-ink-2 leading-relaxed max-w-xl">
                  {t.line}
                </p>
                <span
                  className={`col-start-2 sm:col-start-4 font-mono text-[0.68rem] uppercase tracking-widest ${
                    t.live ? "text-good" : "text-ink-3"
                  }`}
                >
                  {t.status}
                </span>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ───────────────────────────────────────────── four levers */}
      <Section label="Tier 0" index="04" className="border-t hairline">
        <Reveal>
          <h2 className="display text-4xl sm:text-6xl leading-[1.02] max-w-[12ch]">
            Four levers on the curve.
          </h2>
          <p className="mt-8 text-lg text-ink-2 leading-relaxed max-w-2xl">
            Working memory is the wedge nobody else builds. Three levers are
            live; the fourth is named, not shipped.
          </p>
        </Reveal>
        <div className="mt-16 grid gap-px sm:grid-cols-2">
          {LEVERS.map((l, i) => (
            <Reveal key={l.tag} delay={i * 80}>
              <div className="py-8 sm:px-8 sm:first:pl-0 h-full">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm text-copper">{l.tag}</span>
                  <span
                    className={`font-mono text-[0.66rem] uppercase tracking-widest ${
                      l.status.startsWith("Built") ? "text-good" : "text-ink-3"
                    }`}
                  >
                    {l.status}
                  </span>
                </div>
                <h3 className="display text-xl mt-4">{l.name}</h3>
                <p className="mt-3 text-[0.95rem] text-ink-2 leading-relaxed">{l.line}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ───────────────────────────────────────────── the numbers */}
      <Section label="The evidence" index="05" className="border-t hairline">
        <Reveal>
          <div className="flex items-baseline gap-4 flex-wrap">
            <h2 className="display text-4xl sm:text-6xl leading-none">37.2%</h2>
            <span className="font-mono text-[0.7rem] uppercase tracking-widest text-good">
              G1 · pass
            </span>
          </div>
          <p className="mt-6 text-lg text-ink-2 leading-relaxed max-w-2xl">
            Cumulative <i>logical</i> input grows 37.2% slower than Browser Use
            (95% CI 35.6–38.8), at 75/75 verified successes per harness. Logical
            input counts cache reads and writes, so provider caching can&apos;t
            masquerade as memory reduction.
          </p>
        </Reveal>
        <Reveal delay={100}>
          <div className="mt-14 rounded-xl border hairline bg-bg-2/60 p-6 sm:p-8">
            <p className="text-sm text-ink-2 mb-6">
              Cumulative logical input per task, by task length
            </p>
            <CurveChart />
          </div>
        </Reveal>
        <Reveal delay={120}>
          <div className="mt-8 rounded-xl border hairline bg-bg-2/60 p-6 sm:p-8">
            <p className="text-sm text-ink-2 mb-6">
              Mean billed cost per task — before and after cache-key routing
            </p>
            <CostChart />
          </div>
        </Reveal>
        <Reveal delay={140}>
          <p className="mt-8 text-[0.95rem] text-ink-2 leading-relaxed max-w-2xl">
            The honest ledger: on the shortest task Rote still loses on cost, and
            before cache-key routing it ran hotter on latency. This is a
            long-task win, not a universal one — and every figure here carries
            its receipt in{" "}
            <Link href="/docs/benchmarks" className="ulink text-ink">
              the run reports
            </Link>
            .
          </p>
        </Reveal>
      </Section>

      {/* ───────────────────────────────────────────── invariants */}
      <Section label="The guarantees" index="06" className="border-t hairline">
        <Reveal>
          <h2 className="display text-4xl sm:text-6xl leading-[1.02] max-w-[14ch]">
            Five invariants, encoded in tests.
          </h2>
        </Reveal>
        <div className="mt-14 border-t hairline">
          {INVARIANTS.map((inv, i) => (
            <Reveal key={inv.name} delay={i * 70}>
              <div className="grid sm:grid-cols-[1.5rem_1fr] gap-x-6 gap-y-2 py-7 border-b hairline">
                <span className="font-mono text-[0.72rem] text-copper pt-1">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="grid sm:grid-cols-[18rem_1fr] gap-x-8 gap-y-1">
                  <h3 className="display text-lg">{inv.name}</h3>
                  <p className="text-[0.95rem] text-ink-2 leading-relaxed">{inv.body}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ───────────────────────────────────────────── roadmap */}
      <Section label="The arc" index="07" className="border-t hairline">
        <Reveal>
          <h2 className="display text-4xl sm:text-6xl leading-[1.02] max-w-[16ch]">
            From a managed window to a substrate.
          </h2>
        </Reveal>
        <div className="mt-14 border-t hairline">
          {PHASES.map((p, i) => (
            <Reveal key={p.id} delay={i * 60}>
              <div
                className={`grid grid-cols-[3.5rem_1fr_auto] gap-x-5 items-baseline py-6 border-b hairline ${
                  p.state === "here" ? "" : "opacity-80"
                }`}
              >
                <span
                  className={`font-mono text-sm ${
                    p.state === "here" ? "text-copper" : "text-ink-3"
                  }`}
                >
                  {p.id}
                </span>
                <div>
                  <span className="text-ink">{p.theme}</span>
                  <span className="hidden sm:inline text-ink-3"> — “{p.line}”</span>
                </div>
                <span className="font-mono text-[0.66rem] uppercase tracking-widest text-ink-3">
                  {p.state === "here" ? (
                    <span className="text-copper">now</span>
                  ) : p.state === "done" ? (
                    <span className="text-good">done</span>
                  ) : (
                    p.state
                  )}
                </span>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={100}>
          <div className="mt-16 flex flex-col sm:flex-row items-start sm:items-end justify-between gap-8">
            <p className="display text-3xl sm:text-4xl leading-[1.1] max-w-[18ch]">
              The wedge is the cost curve. The precondition is auditable
              determinism.
            </p>
            <Link
              href="/docs"
              className="pill rounded-full bg-ink text-bg text-sm font-medium px-6 py-3 hover:bg-copper shrink-0"
            >
              Read the docs
            </Link>
          </div>
        </Reveal>
      </Section>
    </div>
  );
}
