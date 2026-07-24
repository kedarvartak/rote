import Link from "next/link";
import { HeroDemo } from "@/components/HeroDemo";
import { CurveChart } from "@/components/CurveChart";
import { CostChart } from "@/components/CostChart";
import { Reveal } from "@/components/Reveal";
import { RoadmapCascade } from "@/components/RoadmapCascade";

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
    rule: "No code path may report success when a verify or expect check failed — success is decided by page state, never by the absence of an exception.",
    enforcement: "The sacred invariant suite touches every executor exit path.",
  },
  {
    n: "II",
    name: "Never worse than baseline",
    rule: "Fallback to the plain agent is always reachable and clean; a Rote miss costs one cheap match call.",
    enforcement: "Fallback paths log why they fired — classification, not just that.",
  },
  {
    n: "III",
    name: "Never cross environments",
    rule: "A playbook learned on staging can never fire on prod.",
    enforcement: "The structural fingerprint is a hard gate before any fuzzy matching.",
  },
  {
    n: "IV",
    name: "Everything versioned",
    rule: "Store mutations are append-only — no in-place edits of playbooks or patches, ever.",
    enforcement: "Auditable, diffable, exportable as human-readable YAML.",
  },
  {
    n: "V",
    name: "Every model call tagged",
    rule: "All usage flows through one client wrapper with a source tag — planner, matcher, slot, repair, verify, distill.",
    enforcement: "Direct SDK calls outside the wrapper fail lint.",
  },
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
      <h2 className="mt-3 font-display text-3xl sm:text-4xl leading-[1.12] tracking-tight">
        {title}
      </h2>
      {lede && <p className="mt-4 text-ink-2 leading-relaxed">{lede}</p>}
    </div>
  );
}

export default function Home() {
  return (
    <div>
      {/* ---------------------------------------------------------- hero */}
      <section className="dotgrid border-b hairline">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 pt-16 sm:pt-28 pb-16 sm:pb-20">
          <Reveal>
            <p className="font-display text-lg sm:text-xl text-copper-bright">
              rote · the memory manager for browser agents
            </p>
            <h1 className="mt-5 font-display text-[2.6rem] sm:text-[4.4rem] leading-[1.08] tracking-tight">
              Every harness has memory.
              <br />
              <span className="text-ink-2">None of them manages it.</span>
            </h1>
          </Reveal>
          <Reveal delay={120}>
            <div className="mt-8 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-10">
              <div className="max-w-[52ch]">
                <p className="text-ink-2 text-lg leading-relaxed">
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
              </div>
              <dl className="grid grid-cols-3 gap-8 lg:text-right shrink-0">
                <div>
                  <dd className="font-display text-4xl text-copper-bright tabular-nums">
                    37.2%
                  </dd>
                  <dt className="mt-1 text-[0.72rem] text-ink-2">
                    slower token growth
                  </dt>
                </div>
                <div>
                  <dd className="font-display text-4xl tabular-nums">75/75</dd>
                  <dt className="mt-1 text-[0.72rem] text-ink-2">
                    verified successes
                  </dt>
                </div>
                <div>
                  <dd className="font-display text-4xl tabular-nums">99.6%</dd>
                  <dt className="mt-1 text-[0.72rem] text-ink-2">
                    smaller observations
                  </dt>
                </div>
              </dl>
            </div>
          </Reveal>
          <Reveal delay={240}>
            <div className="mt-14 sm:mt-16">
              <HeroDemo />
            </div>
          </Reveal>
        </div>
      </section>

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
        <div className="mt-12 grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:items-stretch items-start">
          <Reveal className="h-full">
            {/* stretches to the right column's height: the bar rows spread
                across the extra room so the growth reads at full size */}
            <div className="h-full rounded-sm border hairline bg-surface p-5 sm:p-7 flex flex-col">
              <p className="font-mono text-[0.68rem] tracking-widest uppercase text-muted mb-5">
                fixture B2 · input tokens per call · frozen pages
              </p>
              <div className="flex-1 flex flex-col justify-between gap-2">
                {B2_TOKENS.map((t, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="font-mono text-[0.68rem] text-muted w-12 tabular-nums shrink-0">
                      step {i + 1}
                    </span>
                    <div className="flex-1">
                      <div
                        className="h-3.5 rounded-[2px] bg-blue/70"
                        style={{ width: `${(t / 953) * 100 * 0.92}%` }}
                      />
                    </div>
                    <span className="font-mono text-[0.68rem] text-ink-2 tabular-nums shrink-0">
                      {t}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-5 pt-4 border-t hairline text-[0.8rem] text-ink-2 leading-relaxed">
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
          <div className="mt-12 space-y-10">
            <Reveal>
              <div className="rounded-sm border hairline bg-surface p-5 sm:p-8">
                <div className="flex flex-col lg:flex-row lg:items-baseline lg:justify-between gap-1 mb-7">
                  <p className="font-display text-2xl sm:text-3xl">
                    <span className="text-copper-bright">37.2% slower growth</span>{" "}
                    <span className="text-ink-2 text-base sm:text-lg">
                      [95% CI 35.6–38.8] vs a 30% launch floor
                    </span>
                  </p>
                  <p className="text-sm text-ink-2 lg:shrink-0">
                    Cumulative logical input per task, by task length
                  </p>
                </div>
                <CurveChart />
              </div>
            </Reveal>
            {/* the caveat sits between the two charts: G1 shows the token win,
                this admits the cost gap, T11 below shows how it was closed */}
            <Reveal delay={80}>
              <div className="rounded-sm border border-blue/30 bg-blue/5 p-5 text-[0.85rem] leading-relaxed text-ink-2 max-w-3xl">
                <p className="font-mono text-[0.65rem] uppercase tracking-widest text-blue-bright mb-2">
                  the honest ledger
                </p>
                In this frozen matrix Rote was <i>not</i> cheaper: 5.4% more
                expensive at WP-N25 with 6.4% higher p50 latency, because
                Browser Use received more discounted cache reads. That gap is
                what the run below was made to close — and on the shortest
                cell, WP-N09, Rote still loses on billed cost. A long-task
                win, not a universal one. Every claim carries its receipt in{" "}
                <Link href="/docs/benchmarks" className="text-ink underline decoration-copper/60 underline-offset-2 hover:text-copper-bright transition-colors">
                  the run reports
                </Link>
                .
              </div>
            </Reveal>
            <Reveal delay={100}>
              <div className="rounded-sm border hairline bg-surface p-5 sm:p-8">
                <div className="flex flex-col lg:flex-row lg:items-baseline lg:justify-between gap-1 mb-7">
                  <p className="font-display text-2xl sm:text-3xl">
                    <span className="text-copper-bright">16.0% cheaper</span>{" "}
                    <span className="text-ink-2 text-base sm:text-lg">
                      than Browser Use at WP-N25
                    </span>
                  </p>
                  <p className="text-sm text-ink-2 lg:shrink-0">
                    T11 · mean billed cost per task, before → after cache-key routing
                  </p>
                </div>
                <CostChart />
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
        <Reveal delay={80}>
          <div className="mt-12 overflow-x-auto rounded-sm border hairline">
            <table className="w-full text-[0.9rem] min-w-[44rem]">
              <thead className="bg-surface border-b hairline text-left">
                <tr>
                  <th className="px-4 py-3 font-mono text-[0.62rem] uppercase tracking-widest text-muted font-normal w-14">
                    №
                  </th>
                  <th className="px-4 py-3 font-mono text-[0.62rem] uppercase tracking-widest text-muted font-normal w-56">
                    Invariant
                  </th>
                  <th className="px-4 py-3 font-mono text-[0.62rem] uppercase tracking-widest text-muted font-normal">
                    The rule
                  </th>
                  <th className="px-4 py-3 font-mono text-[0.62rem] uppercase tracking-widest text-muted font-normal w-72">
                    Enforced by
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y hairline">
                {INVARIANTS.map((inv) => (
                  <tr key={inv.n} className="align-top hover:bg-surface/70 transition-colors group">
                    <td className="px-4 py-4 font-display italic text-xl text-copper-bright/80 group-hover:text-copper-bright transition-colors">
                      {inv.n}
                    </td>
                    <td className="px-4 py-4 font-medium text-ink">{inv.name}</td>
                    <td className="px-4 py-4 text-ink-2 leading-relaxed">{inv.rule}</td>
                    <td className="px-4 py-4 text-ink-2 leading-relaxed">{inv.enforcement}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </section>

      {/* ----------------------------------------------------- roadmap */}
      <section className="border-t hairline bg-surface/40">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-20 sm:py-28">
          <Reveal>
            <SectionHead
              eyebrow="docs/05 · roadmap"
              title="From a managed window to a substrate"
              lede="No number, no launch — and the next number is G2's."
            />
          </Reveal>
          <div className="mt-14">
            <RoadmapCascade />
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
