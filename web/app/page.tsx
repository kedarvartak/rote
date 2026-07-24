import Link from "next/link";
import { HeroLedger } from "@/components/HeroLedger";
import { CurveChart } from "@/components/CurveChart";
import { CostChart } from "@/components/CostChart";
import { Reveal } from "@/components/Reveal";
import { CountUp } from "@/components/CountUp";
import { QuoteTicker } from "@/components/QuoteTicker";

/** Staggered word-by-word entrance for the hero headline. */
function Words({ text, from = 0 }: { text: string; from?: number }) {
  return (
    <>
      {text.split(" ").map((w, i) => (
        <span
          key={i}
          className="hero-word"
          style={{ animationDelay: `${from + i * 90}ms` }}
        >
          {w}
          {" "}
        </span>
      ))}
    </>
  );
}

const B2_TOKENS = [637, 677, 716, 759, 800, 839, 876, 917, 953];

const TIERS = [
  {
    id: "0",
    name: "Working memory",
    scope: "within one run",
    forgets: "what it already sent this run",
    bill: "cost is O(n²) in task length",
    field: "Nobody builds it. Rote's wedge — built and measured.",
    built: true,
  },
  {
    id: "1",
    name: "Episodic memory",
    scope: "across runs of a task",
    forgets: "the procedure that worked yesterday",
    bill: "run #50 costs what run #1 cost",
    field: "The field ships unverified replay. Rote adds the trust gate. (P2)",
    built: false,
  },
  {
    id: "2",
    name: "Semantic memory",
    scope: "across tasks on a site",
    forgets: "how the site behaves at all",
    bill: "every task re-learns the portal",
    field: "Nobody. Site memory is designed, not built. (P2)",
    built: false,
  },
];

const LEVERS = [
  {
    tag: "A11",
    name: "Observation eviction",
    effect: "kills the dominant quadratic term",
    detail:
      "Prior observations leave the window; the action ledger stays. Growth drops from ~172 to ~37 tokens per step.",
    status: "Built",
  },
  {
    tag: "A4",
    name: "Diff observations",
    effect: "~90% off the constant",
    detail:
      "After a grounded bootstrap, each step sends a diff. In G1: 849 diffs, median 24 chars, median render-size reduction 99.6%.",
    status: "Built · measured",
  },
  {
    tag: "B3",
    name: "Cache-layout discipline",
    effect: "discounted billing on the surviving prefix",
    detail:
      "Nothing above the stable line may ever mutate. The immutable prefix routes through prompt_cache_key — a 20.5% cost cut at WP-N25.",
    status: "Built · qualified on OpenAI",
  },
  {
    tag: "B4",
    name: "History compaction",
    effect: "turns the curve from quadratic to linear",
    detail:
      "Summarize the far tail of the action ledger under budget. The one tier-0 lever still on the bench — deliberately deferred to P2.",
    status: "Not built",
  },
];

const INVARIANTS = [
  {
    n: "I",
    name: "Never silently wrong",
    body: "No code path may report success when a verify or expect check failed. Success is decided by page state, never by the absence of an exception.",
  },
  {
    n: "II",
    name: "Never worse than baseline",
    body: "Fallback to the plain agent is always reachable and clean. A Rote miss costs one cheap match call, and the fallback logs why it fired.",
  },
  {
    n: "III",
    name: "Never cross environments",
    body: "A structural fingerprint is a hard gate before any fuzzy matching. A playbook learned on staging can't fire on prod.",
  },
  {
    n: "IV",
    name: "Everything versioned",
    body: "Store mutations are append-only. Playbooks and repair patches are auditable, diffable, and exportable as human-readable YAML.",
  },
  {
    n: "V",
    name: "Every model call tagged",
    body: "All usage flows through one client wrapper with a source tag — planner, matcher, slot, repair, verify, distill. Untagged calls fail lint.",
  },
];

const PHASES = [
  { id: "P0", theme: "Foundations", headline: "recorder, replay, verified core", state: "done" },
  { id: "P1", theme: "Working memory", headline: "the first browser agent with a managed context window", state: "here" },
  { id: "P2", theme: "The harness that learns", headline: "your 50th task on a site costs a fraction of your 1st", state: "next" },
  { id: "P3", theme: "Speculation", headline: "warm flows bounded by think-time only", state: "planned" },
  { id: "P4", theme: "Fleet & enterprise", headline: "10K tasks/day, audited, lowest $ per task", state: "planned" },
  { id: "P5", theme: "Platform", headline: "the efficiency substrate other agents build on", state: "planned" },
];

function SectionHead({
  eyebrow,
  title,
  lede,
}: {
  eyebrow: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
}) {
  return (
    <div className="max-w-2xl">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-3 font-display wonk text-3xl sm:text-4xl leading-[1.08] tracking-tight">
        {title}
      </h2>
      <div className="rule-draw mt-5" aria-hidden />
      {lede && <p className="mt-5 text-ink-2 leading-relaxed">{lede}</p>}
    </div>
  );
}

export default function Home() {
  return (
    <div>
      {/* ---------------------------------------------------------- hero */}
      <section className="dotgrid border-b hairline">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 pt-16 sm:pt-24 pb-16 grid gap-12 lg:grid-cols-[1.1fr_1fr] items-center">
          <div>
            <Reveal>
              <p className="eyebrow">rote · the memory manager for browser agents</p>
              <h1
                className="mt-5 font-display wonk text-[2.8rem] sm:text-[4.1rem] leading-[1.02] tracking-tight"
                aria-label="Every harness has memory. None of them manages it."
              >
                <span aria-hidden className="contents">
                  <Words text="Every harness has memory." />
                  <br />
                  <em className="text-copper-bright">
                    <Words text="None of them manages it." from={520} />
                  </em>
                </span>
              </h1>
              <p className="mt-6 text-ink-2 text-lg leading-relaxed max-w-[52ch]">
                Browser agents treat the context window as a garbage dump —
                append, and hope. Rote treats it as a managed resource: a
                budget, an eviction policy, a layout contract, and a trust
                gate on the way back in.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/docs/benchmarks"
                  className="rounded-sm bg-copper text-bg font-medium px-5 py-2.5 text-sm hover:bg-copper-bright transition-colors"
                >
                  See the numbers
                </Link>
                <Link
                  href="/architecture"
                  className="rounded-sm border hairline px-5 py-2.5 text-sm text-ink hover:border-copper/60 transition-colors"
                >
                  Read the architecture
                </Link>
              </div>
            </Reveal>
            <Reveal delay={200}>
              <dl className="mt-12 grid grid-cols-3 gap-6 max-w-md">
                <div>
                  <dt className="text-[0.68rem] font-mono uppercase tracking-widest text-muted">
                    token growth
                  </dt>
                  <dd className="mt-1 font-display text-3xl text-copper-bright tabular-nums">
                    <CountUp to={37.2} decimals={1} suffix="%" />
                  </dd>
                  <dd className="text-[0.72rem] text-ink-2">
                    slower than baseline
                  </dd>
                </div>
                <div>
                  <dt className="text-[0.68rem] font-mono uppercase tracking-widest text-muted">
                    success parity
                  </dt>
                  <dd className="mt-1 font-display text-3xl tabular-nums">
                    <CountUp to={75} suffix="/75" />
                  </dd>
                  <dd className="text-[0.72rem] text-ink-2">verified, per harness</dd>
                </div>
                <div>
                  <dt className="text-[0.68rem] font-mono uppercase tracking-widest text-muted">
                    median diff
                  </dt>
                  <dd className="mt-1 font-display text-3xl tabular-nums">
                    <CountUp to={99.6} decimals={1} suffix="%" />
                  </dd>
                  <dd className="text-[0.72rem] text-ink-2">smaller than a re-send</dd>
                </div>
              </dl>
            </Reveal>
          </div>
          <Reveal delay={300}>
            <div className="frame-ticks p-3 sm:p-4">
              <HeroLedger />
            </div>
          </Reveal>
        </div>
      </section>

      <QuoteTicker />

      {/* ---------------------------------------------- the quadratic */}
      <section className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
        <Reveal>
          <SectionHead
            eyebrow="docs/01 · the problem"
            title={
              <>
                The quadratic <em className="text-copper-bright">nobody names</em>
              </>
            }
            lede={
              <>
                A run of <i>n</i> steps re-sends its whole history every step:
                1 + 2 + … + <i>n</i> prompt-units, so cost is O(n²) in task
                length. Everything the field competes on shrinks the per-step
                prompt. That lowers the constant.{" "}
                <span className="text-ink">Nobody has touched the exponent.</span>
              </>
            }
          />
        </Reveal>
        <div className="mt-12 grid gap-10 lg:grid-cols-2 items-start">
          <Reveal>
            <div className="frame-ticks rounded-sm border hairline bg-surface p-5">
              <p className="font-mono text-[0.68rem] tracking-widest uppercase text-muted mb-4">
                fixture B2 · input tokens per call · frozen pages
              </p>
              <div className="space-y-1.5">
                {B2_TOKENS.map((t, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="font-mono text-[0.68rem] text-muted w-12 tabular-nums">
                      step {i + 1}
                    </span>
                    <div
                      className="h-3 rounded-[2px] bg-blue/70"
                      style={{ width: `${(t / 953) * 100 * 0.78}%` }}
                    />
                    <span className="font-mono text-[0.68rem] text-ink-2 tabular-nums">
                      {t}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-[0.8rem] text-ink-2 leading-relaxed">
                +38% per-call growth over ten steps — and 21% of the run&apos;s
                input bill is re-reading text it already sent, on a page that
                distills to ten nodes.
              </p>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <div className="space-y-6 lg:pt-2">
              <blockquote className="border-l-2 border-copper pl-5 font-display text-xl sm:text-2xl leading-snug text-ink">
                The context window is RAM. Observations are pages, dropping
                them is eviction, diffing is delta encoding, the prompt cache
                is L2, compaction is GC.{" "}
                <em className="text-copper-bright">
                  Every one of those has a manager in an OS. None of them has
                  one in a browser agent.
                </em>
              </blockquote>
              <p className="text-ink-2 leading-relaxed">
                Rote&apos;s tier-0 policy is one sentence:{" "}
                <span className="text-ink font-medium">
                  keep what you did, not what you saw.
                </span>{" "}
                The action ledger survives — ~37 tokens per step. Stale
                observations leave the window, and the current page arrives as
                a diff against the last grounded bootstrap.
              </p>
              <p className="text-ink-2 leading-relaxed">
                The name is the thesis: <i>rote</i> — doing something from
                memory, by repetition, without re-deriving it. Memoization
                applied to agent trajectories, invalidated by assertion rather
                than TTL.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------ memory spine */}
      <section className="border-y hairline bg-surface/40">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
          <Reveal>
            <SectionHead
              eyebrow="docs/02 · the memory spine"
              title="Three amnesias, three tiers"
              lede="Browser agents forget at three timescales and pay again at every one. Each tier is a memory Rote manages — and every tier is assertion-gated on the way back in, because memory that might be wrong is worse than no memory."
            />
          </Reveal>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {TIERS.map((t, i) => (
              <Reveal key={t.id} delay={i * 120}>
                <article
                  className={`h-full rounded-sm border p-6 flex flex-col gap-3 transition-colors ${
                    t.built
                      ? "border-copper/50 bg-surface hover:border-copper"
                      : "hairline bg-surface/60 hover:border-ink-2/30"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[0.7rem] tracking-widest text-muted">
                      TIER {t.id}
                    </span>
                    <span
                      className={`font-mono text-[0.62rem] tracking-widest uppercase px-2 py-0.5 rounded-[2px] border ${
                        t.built
                          ? "text-copper-bright border-copper/50"
                          : "text-muted border-ink-2/20"
                      }`}
                    >
                      {t.built ? "P1 · now" : "designed"}
                    </span>
                  </div>
                  <h3 className="font-display text-2xl">{t.name}</h3>
                  <dl className="text-[0.83rem] leading-relaxed space-y-2 text-ink-2">
                    <div>
                      <dt className="font-mono text-[0.62rem] uppercase tracking-widest text-muted">scope</dt>
                      <dd>{t.scope}</dd>
                    </div>
                    <div>
                      <dt className="font-mono text-[0.62rem] uppercase tracking-widest text-muted">what it forgets</dt>
                      <dd>{t.forgets}</dd>
                    </div>
                    <div>
                      <dt className="font-mono text-[0.62rem] uppercase tracking-widest text-muted">the bill</dt>
                      <dd className="text-ink">{t.bill}</dd>
                    </div>
                  </dl>
                  <p className="mt-auto pt-2 text-[0.8rem] text-ink-2 border-t hairline">
                    {t.field}
                  </p>
                </article>
              </Reveal>
            ))}
          </div>
          <Reveal delay={150}>
            <p className="mt-8 max-w-2xl text-ink-2 leading-relaxed">
              <span className="font-mono text-[0.7rem] uppercase tracking-widest text-copper-bright mr-2">
                trust gate
              </span>
              Not a fourth tier — the precondition for all three. Reuse
              without verification is a machine for repeating a mistake at
              volume.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------- four levers */}
      <section className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
        <Reveal>
          <SectionHead
            eyebrow="docs/05 · tier 0"
            title="Four levers on the curve"
            lede="Working memory is the wedge nobody else builds. Three of the four levers are live; the honest ledger says so about the fourth."
          />
        </Reveal>
        <div className="mt-12 grid gap-px bg-ink/10 border hairline rounded-sm overflow-hidden sm:grid-cols-2">
          {LEVERS.map((l, i) => (
            <Reveal key={l.tag} delay={i * 90} className="h-full">
              <article className="h-full bg-surface p-6 hover:bg-surface-2 transition-colors">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-copper-bright text-sm">{l.tag}</span>
                  <span
                    className={`font-mono text-[0.62rem] uppercase tracking-widest ${
                      l.status === "Not built" ? "text-muted" : "text-good"
                    }`}
                  >
                    {l.status}
                  </span>
                </div>
                <h3 className="mt-3 font-display text-xl">{l.name}</h3>
                <p className="mt-1 text-[0.85rem] text-copper-bright/90">{l.effect}</p>
                <p className="mt-3 text-[0.85rem] text-ink-2 leading-relaxed">{l.detail}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------- the number */}
      <section className="border-y hairline bg-surface/40">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
          <Reveal>
            <SectionHead
              eyebrow="T10 · exit gate G1 · PASS"
              title={
                <>
                  The curve, <em className="text-copper-bright">measured</em>
                </>
              }
              lede={
                <>
                  Cumulative <i>logical</i> input — uncached input + cache
                  reads + cache writes, so provider caching cannot masquerade
                  as memory reduction. gpt-4.1-mini, 15 matched repetitions
                  per cell, 75/75 verified successes per harness, 95%
                  seeded-bootstrap CIs.
                </>
              }
            />
          </Reveal>
          <div className="mt-12 grid gap-12 lg:grid-cols-2 items-start">
            <Reveal>
              <div className="frame-ticks rounded-sm border hairline bg-surface p-5">
                <p className="text-sm text-ink-2 mb-1">
                  Cumulative logical input per task, by task length
                </p>
                <p className="font-display text-2xl mb-4">
                  <span className="text-copper-bright">37.2% slower growth</span>{" "}
                  <span className="text-ink-2 text-base">[95% CI 35.6–38.8] vs a 30% launch floor</span>
                </p>
                <CurveChart />
              </div>
            </Reveal>
            <Reveal delay={120}>
              <div className="frame-ticks rounded-sm border hairline bg-surface p-5">
                <p className="text-sm text-ink-2 mb-1">
                  T11 · mean billed cost per task, before → after cache-key routing
                </p>
                <p className="font-display text-2xl mb-4">
                  <span className="text-copper-bright">16.0% cheaper</span>{" "}
                  <span className="text-ink-2 text-base">than Browser Use at WP-N25</span>
                </p>
                <CostChart />
              </div>
              <div className="mt-5 rounded-sm border border-blue/30 bg-blue/5 p-5 text-[0.85rem] leading-relaxed text-ink-2">
                <p className="font-mono text-[0.65rem] uppercase tracking-widest text-blue-bright mb-2">
                  the honest ledger
                </p>
                On the shortest cell, WP-N09, Rote still loses on billed cost —
                and before cache-key routing it was 5.4% more expensive at
                WP-N25 with 6.4% higher p50 latency. This is a long-task cache
                win, not a universal one. Every claim on this site carries its
                receipt in{" "}
                <Link href="/docs/benchmarks" className="text-ink underline decoration-copper/60 underline-offset-2 hover:text-copper-bright transition-colors">
                  the run reports
                </Link>
                .
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------- invariants */}
      <section className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
        <Reveal>
          <SectionHead
            eyebrow="the sacred invariant suite"
            title="Five invariants, encoded in tests"
            lede="Non-negotiable, never “just this once.” Every one is enforced by the sacred invariant suite that touches every executor exit path."
          />
        </Reveal>
        <div className="mt-12 divide-y hairline border-y hairline">
          {INVARIANTS.map((inv, i) => (
            <Reveal key={inv.n} delay={i * 60}>
              <div className="py-6 grid gap-2 sm:grid-cols-[8rem_16rem_1fr] sm:gap-6 items-baseline group">
                <span className="font-display italic text-2xl text-copper-bright/80 group-hover:text-copper-bright transition-colors">
                  {inv.n}
                </span>
                <h3 className="font-medium">{inv.name}</h3>
                <p className="text-[0.9rem] text-ink-2 leading-relaxed">{inv.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------- roadmap */}
      <section className="border-t hairline bg-surface/40">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
          <Reveal>
            <SectionHead
              eyebrow="docs/05 · roadmap"
              title="From a managed window to a substrate"
              lede="One phase at a time, each behind an exit gate with a number on it. No number, no launch."
            />
          </Reveal>
          <div className="mt-12 overflow-x-auto">
            <ol className="flex gap-4 min-w-max pb-2">
              {PHASES.map((p, i) => (
                <Reveal key={p.id} delay={i * 80}>
                  <li
                    className={`w-56 rounded-sm border p-5 h-full ${
                      p.state === "here"
                        ? "border-copper bg-copper/10"
                        : p.state === "done"
                          ? "border-good/40 bg-surface"
                          : "hairline bg-surface"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm text-copper-bright">{p.id}</span>
                      <span className={`font-mono text-[0.6rem] uppercase tracking-widest ${
                        p.state === "here" ? "text-copper-bright" : p.state === "done" ? "text-good" : "text-muted"
                      }`}>
                        {p.state === "here" ? "← you are here" : p.state}
                      </span>
                    </div>
                    <h3 className="mt-2 font-medium text-[0.95rem]">{p.theme}</h3>
                    <p className="mt-2 text-[0.78rem] text-ink-2 leading-relaxed">
                      &ldquo;{p.headline}&rdquo;
                    </p>
                  </li>
                </Reveal>
              ))}
            </ol>
          </div>
          <Reveal>
            <div className="mt-14 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 rounded-sm border hairline bg-surface p-7">
              <div>
                <p className="font-display text-2xl">
                  The wedge is the cost curve.{" "}
                  <em className="text-copper-bright">The precondition is auditable determinism.</em>
                </p>
                <p className="mt-2 text-ink-2 text-sm">
                  The compounding asset is the accumulated, verified memory itself.
                </p>
              </div>
              <div className="flex gap-3 shrink-0">
                <Link
                  href="/docs"
                  className="rounded-sm bg-copper text-bg font-medium px-5 py-2.5 text-sm hover:bg-copper-bright transition-colors"
                >
                  Read the docs
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
