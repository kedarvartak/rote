import type { Metadata } from "next";
import { Reveal } from "@/components/Reveal";

export const metadata: Metadata = {
  title: "Architecture — Rote",
  description:
    "The memory spine, the four planes, the control loop, the perception pipeline, the context assembler, the repair ladder, and the package map — how Rote manages a browser agent's context window.",
};

/* ---------------------------------------------------------------- shells */

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

/** Flat copper arrow between pipeline stages. */
function FlowArrow() {
  return (
    <div className="hidden lg:flex items-center shrink-0 w-9" aria-hidden>
      <svg viewBox="0 0 36 16" className="w-9" fill="none">
        <path d="M0 8 H28" stroke="#c2751f" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M23 3 L30 8 L23 13" stroke="#c2751f" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ data */

const PLANES = [
  {
    name: "Perception",
    pkgs: "@rote/browser · @rote/perception",
    body: "Capture pages over CDP, distill them to compact interactive trees, assign stable element IDs, and send diffs instead of full page dumps.",
  },
  {
    name: "Decision",
    pkgs: "@rote/agent · @rote/llm",
    body: "Own the context layout, tag every model call by source, and skip model calls entirely when memory or replay can safely act.",
  },
  {
    name: "Action",
    pkgs: "@rote/action · @rote/executor",
    body: "Typed browser actions with settledness detection, self-healing element resolution, per-step assertions, and a scoped repair ladder.",
  },
  {
    name: "Learning",
    pkgs: "@rote/recorder · @rote/bench",
    body: "Record every run losslessly, promote verified runs into replay candidates, and measure everything behind launch gates.",
  },
];

const LOOP = [
  { step: "fingerprint", note: "hard gate — never cross environments", built: true },
  { step: "match playbook", note: "semantic match + bind (P2)", built: false },
  { step: "replay if confident", note: "deterministic steps cost zero LLM tokens", built: true },
  { step: "settle", note: "zero pending requests + a quiet DOM window", built: true },
  { step: "observe", note: "distill → stable IDs → budget", built: true },
  { step: "diff-encode", note: "A4 — median diff 24 chars on real pages", built: true },
  { step: "decide", note: "planner call over the assembled context", built: true },
  { step: "dispatch & record", note: "typed action, append-only trajectory", built: true },
  { step: "expect check", note: "optional per-step assertion on page state", built: true },
  { step: "repair ladder", note: "retry → scoped repair → clean fallback", built: true },
  { step: "verify gate", note: "final checks decide success — never exceptions", built: true },
];

const PIPELINE = [
  { stage: "capture", how: "CDP snapshot of the live page", num: "6,784 elements", src: "wp-admin, 120 posts" },
  { stage: "distill", how: "interactive tree, noise dropped", num: "797 nodes", src: "787 actionable" },
  { stage: "stable IDs", how: "role + name + ancestry hash", num: "survives re-renders", src: "zero variance ×15 runs" },
  { stage: "render", how: "budgeted compact markup", num: "~22,279 tok", src: "full page, once" },
  { stage: "diff", how: "vs last grounded bootstrap", num: "median 24 chars", src: "−99.6% vs re-send" },
];

const LAYOUT = [
  {
    zone: "Immutable prefix",
    tokens: "~268 tok",
    body: "System prompt, task, tool schemas. Nothing above this line may ever mutate — not a timestamp, not a run id. A SHA-256 of the prefix routes through prompt_cache_key.",
    accent: true,
  },
  {
    zone: "Site brief",
    tokens: "session-stable",
    body: "Tier-2 knowledge of the portal, held stable across the session so it stays cache-eligible. Planned — P2.",
    accent: false,
  },
  {
    zone: "Action ledger",
    tokens: "~37 tok/step",
    body: "One compact JSON action per prior step. This is what survives eviction: keep what you did, not what you saw.",
    accent: true,
  },
  {
    zone: "Live tail",
    tokens: "~135 tok (or a diff)",
    body: "The current page only — full on bootstrap, then diffs against the last grounded observation. Prior observations are evicted.",
    accent: true,
  },
];

const HARDENING = [
  {
    name: "Settledness",
    body: "An action dispatches only when the page is quiet: zero pending network requests plus an unchanged DOM for a 250ms window, polled every 50ms, capped at 5s.",
    tag: "waitForSettled",
  },
  {
    name: "Resolution ladder",
    body: "Element targets self-heal in order — stable ID, then exact role + name, then text proximity. If no safe target resolves, the step fails closed; it never guesses.",
    tag: "resolveElementTarget",
  },
  {
    name: "Closed expect DSL",
    body: "Assertions come from a closed set of ten primitives over page state. Judgment steps classify into a closed enum — an out-of-enum answer is a hard error, not a shrug.",
    tag: "evaluateExpect",
  },
];

const LADDER = [
  { rung: "Retry", cost: "≈ free", body: "Transient failures — a settle-and-retry with no model involvement." },
  { rung: "Scoped repair", cost: "≈ one step", body: "One model call over a narrow context; emits a versioned patch, never an in-place edit." },
  { rung: "Fallback", cost: "one full run", body: "The plain agent takes over, the run is recorded, the failure is re-learned. The fallback logs why it fired." },
];

const LIFECYCLE = [
  { step: "dispatch", note: "every tools/call passes through the recorder proxy — observationally invisible to both sides" },
  { step: "append", note: "one TrajectoryEvent per call, fsync before seq advances — crash recovery can always find the last complete event" },
  { step: "spill", note: "results over 64KB go to content-addressed blobs; the trajectory stays lean" },
  { step: "manifest", note: "run id, environment fingerprint, verify outcome — the run's identity card" },
  { step: "verify", note: "final page-state checks decide success; a failed check can never report success" },
  { step: "promote", note: "a verified run becomes a replay candidate, keyed by exact fingerprint" },
  { step: "replay", note: "next time the fingerprint matches: deterministic steps, zero LLM tokens, every expect re-checked" },
];

const PKG_LAYERS = [
  { layer: "surface", pkgs: [{ n: "cli", d: "the rote command — run, inspect, promote" }] },
  {
    layer: "learning",
    pkgs: [
      { n: "recorder", d: "lossless crash-safe proxy" },
      { n: "bench", d: "matrices, gates, bootstrap CIs" },
    ],
  },
  { layer: "decision", pkgs: [{ n: "agent", d: "observe → plan → act loop" }] },
  {
    layer: "action",
    pkgs: [
      { n: "executor", d: "verified playbook replay" },
      { n: "action", d: "settledness + resolution" },
    ],
  },
  {
    layer: "perception",
    pkgs: [
      { n: "browser", d: "CDP + fixture backends" },
      { n: "perception", d: "distill, stable IDs, diffs" },
    ],
  },
  { layer: "boundary", pkgs: [{ n: "llm", d: "source-tagged provider client" }] },
  { layer: "spine", pkgs: [{ n: "core", d: "zod schemas, pure logic, zero I/O" }] },
];

const TYPES = [
  { t: "StableNodeId", d: "role + accessible name + ancestry content hash — the same control keeps the same id across re-renders" },
  { t: "Observation", d: "full | diff | summary — a page is sent whole exactly once, then as deltas" },
  { t: "Action", d: "navigate | click | fill | select | extract | done | fail — a small closed verb set, not 50 overlapping tools" },
  { t: "StepClass", d: "replay | speculated | grounded-routine | frontier | recovery — every step knows why it ran" },
  { t: "Expect", d: "ten closed assertion primitives over page state — the trust gate's vocabulary" },
];

/* ------------------------------------------------------------------ page */

export default function ArchitecturePage() {
  return (
    <div className="mx-auto max-w-6xl px-5 sm:px-8">
      {/* header */}
      <header className="pt-16 sm:pt-24 pb-12 border-b hairline">
        <Reveal>
          <p className="eyebrow">docs/02 · architecture</p>
          <h1 className="mt-4 font-display text-4xl sm:text-5xl tracking-tight leading-[1.08] max-w-3xl">
            The context window as a{" "}
            <em className="text-copper-bright">managed resource</em>
          </h1>
          <p className="mt-5 text-ink-2 text-lg leading-relaxed max-w-2xl">
            The context window is RAM. Observations are pages, dropping them is
            eviction, diffing is delta encoding, the prompt cache is L2,
            compaction is GC, a playbook is a cached compiled program, and site
            memory is the persistent store. Every one of those has a manager in
            an OS — Rote gives them one in a browser agent.
          </p>
        </Reveal>
      </header>

      {/* memory spine */}
      <section className="py-16 sm:py-20">
        <Reveal>
          <SectionHead
            eyebrow="the memory spine"
            title="Three tiers, one gate"
            lede="Each tier caches what the one below keeps forgetting. None of it re-enters the window unverified."
          />
        </Reveal>
        <Reveal delay={120}>
          <div className="mt-12">
            <div className="grid gap-4 md:grid-cols-3">
              {[
                {
                  id: "0",
                  name: "Working memory",
                  scope: "within one run",
                  keeps: "the action ledger; evicts stale observations, diffs the live page",
                  status: "built · measured",
                  live: true,
                },
                {
                  id: "1",
                  name: "Episodic memory",
                  scope: "across runs of a task",
                  keeps: "verified playbooks, replayed deterministically at zero LLM tokens",
                  status: "replay built · distiller P2",
                  live: false,
                },
                {
                  id: "2",
                  name: "Semantic memory",
                  scope: "across tasks on a site",
                  keeps: "how the portal behaves — briefs, quirks, transition models",
                  status: "designed · P2",
                  live: false,
                },
              ].map((t) => (
                <div
                  key={t.id}
                  className={`rounded-sm border p-5 ${
                    t.live ? "border-copper/50 bg-surface" : "hairline bg-surface/60"
                  }`}
                >
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-[0.7rem] tracking-widest text-muted">
                      TIER {t.id}
                    </span>
                    <span
                      className={`font-mono text-[0.62rem] uppercase tracking-widest ${
                        t.live ? "text-good" : "text-muted"
                      }`}
                    >
                      {t.status}
                    </span>
                  </div>
                  <h3 className="mt-2 font-display text-xl">{t.name}</h3>
                  <p className="mt-0.5 font-mono text-[0.68rem] text-muted">{t.scope}</p>
                  <p className="mt-3 text-[0.85rem] text-ink-2 leading-relaxed">{t.keeps}</p>
                </div>
              ))}
            </div>
            {/* the gate under all three */}
            <div className="mt-6 relative">
              <div className="hidden md:grid grid-cols-3 gap-4 absolute -top-5 inset-x-0" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex justify-center">
                    <svg viewBox="0 0 16 20" className="w-4 h-5" fill="none">
                      <path d="M8 20 V6" stroke="#c2751f" strokeWidth="1.5" />
                      <path d="M3 9 L8 3 L13 9" stroke="#c2751f" strokeWidth="1.5" />
                    </svg>
                  </div>
                ))}
              </div>
              <div className="rounded-sm border border-copper/40 bg-copper/[0.07] px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <p className="font-mono text-[0.7rem] tracking-[0.18em] uppercase text-copper-bright shrink-0">
                  trust gate — assertion on the way back in
                </p>
                <p className="text-[0.85rem] text-ink-2">
                  Memory that might be wrong is worse than no memory. Success is
                  page state, never the absence of an exception.
                </p>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* four planes */}
      <section className="py-16 sm:py-20 border-t hairline">
        <Reveal>
          <SectionHead eyebrow="where the code lives" title="The four planes" />
        </Reveal>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PLANES.map((p, i) => (
            <Reveal key={p.name} delay={i * 90} className="h-full">
              <article className="h-full rounded-sm border hairline bg-surface p-5 hover:border-copper/50 transition-colors flex flex-col">
                <h3 className="font-display text-xl">{p.name}</h3>
                <p className="mt-2 text-[0.84rem] text-ink-2 leading-relaxed">{p.body}</p>
                <p className="mt-auto pt-3 font-mono text-[0.65rem] text-muted">{p.pkgs}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      {/* control loop */}
      <section className="py-16 sm:py-20 border-t hairline">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr]">
          <Reveal>
            <p className="eyebrow">the control loop</p>
            <h2 className="mt-3 font-display text-3xl leading-tight">
              Replay when confident, plan when not, verify always
            </h2>
            <p className="mt-4 text-ink-2 leading-relaxed">
              The loop below is the actual execution order — a hard environment
              gate first, memory next, the model last. Deterministic replay
              steps cost zero LLM tokens; every exit path ends at the verify
              gate. Compression shrinks a step;{" "}
              <span className="text-ink">Rote declines to run it.</span>
            </p>
            <p className="mt-4 text-[0.8rem] font-mono text-muted">
              solid dot — built · hollow dot — designed (P2)
            </p>
          </Reveal>
          <Reveal delay={120}>
            <ol className="relative border-l hairline ml-2">
              {LOOP.map((s) => (
                <li key={s.step} className="relative pl-7 pb-5 last:pb-0 group">
                  <span
                    className={`absolute -left-[5px] top-1.5 w-[9px] h-[9px] rounded-full border-2 ${
                      s.built ? "bg-copper border-copper" : "bg-bg border-muted"
                    }`}
                  />
                  <span className="font-mono text-[0.85rem] text-ink group-hover:text-copper-bright transition-colors">
                    {s.step}
                  </span>
                  <span className="ml-3 text-[0.8rem] text-ink-2">{s.note}</span>
                </li>
              ))}
            </ol>
          </Reveal>
        </div>
      </section>

      {/* perception pipeline */}
      <section className="py-16 sm:py-20 border-t hairline">
        <Reveal>
          <SectionHead
            eyebrow="the perception pipeline"
            title="From 6,784 elements to a 24-character diff"
            lede="Every number below is measured on the real WordPress admin fixture — 120 seeded posts, 100 rows per page — with zero variance across 15 repetitions."
          />
        </Reveal>
        <Reveal delay={120}>
          <div className="mt-10 flex flex-col lg:flex-row gap-3 lg:gap-0 lg:items-stretch">
            {PIPELINE.map((s, i) => (
              <div key={s.stage} className="contents">
                {i > 0 && <FlowArrow />}
                <div className="lg:flex-1 min-w-0 rounded-sm border hairline bg-surface p-4 flex flex-col">
                  <p className="font-mono text-[0.68rem] tracking-widest uppercase text-copper-bright">
                    {s.stage}
                  </p>
                  <p className="mt-1.5 text-[0.8rem] text-ink-2 leading-relaxed">{s.how}</p>
                  <p className="mt-auto pt-3 font-display text-lg text-ink">{s.num}</p>
                  <p className="font-mono text-[0.62rem] text-muted">{s.src}</p>
                </div>
              </div>
            ))}
          </div>
        </Reveal>
        <Reveal delay={150}>
          <p className="mt-6 text-[0.9rem] text-ink-2 leading-relaxed max-w-2xl">
            When a first or replacement observation blows past the ordinary
            budget, the renderer records one grounded bootstrap under a
            100,000-character emergency ceiling, then returns to diffs — and
            fails before planning above the ceiling rather than emitting a
            selector-free summary.
          </p>
        </Reveal>
      </section>

      {/* context assembler */}
      <section className="py-16 sm:py-20 border-t hairline">
        <div className="grid gap-12 lg:grid-cols-2 items-start">
          <Reveal>
            <p className="eyebrow">the context assembler</p>
            <h2 className="mt-3 font-display text-3xl leading-tight">
              One module owns the layout
            </h2>
            <p className="mt-4 text-ink-2 leading-relaxed">
              The ContextAssembler is the only module allowed to order
              messages. Tests fail if any volatile token — a timestamp, a run
              id — lands above the stable line, and the runtime re-asserts
              prefix immutability on every call. That discipline is what makes
              the prefix cache-eligible: the 50 lines of cache plumbing are
              trivial; the discipline is not.
            </p>
            <p className="mt-4 text-ink-2 leading-relaxed">
              With eviction on, a step adds ~37 tokens instead of ~172 — the
              quadratic term belongs to observations, and observations
              don&apos;t accumulate.
            </p>
          </Reveal>
          <Reveal delay={120}>
            <div className="rounded-sm border hairline overflow-hidden">
              {LAYOUT.map((z) => (
                <div
                  key={z.zone}
                  className={`p-5 border-b last:border-b-0 hairline ${
                    z.accent ? "bg-surface" : "bg-surface/40"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <h3 className={`font-medium text-[0.95rem] ${z.accent ? "" : "text-ink-2"}`}>
                      {z.zone}
                    </h3>
                    <span className="font-mono text-[0.7rem] text-copper-bright tabular-nums shrink-0">
                      {z.tokens}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[0.8rem] text-ink-2 leading-relaxed">{z.body}</p>
                </div>
              ))}
              <div className="p-3 bg-copper/10 text-center font-mono text-[0.65rem] tracking-widest uppercase text-copper-bright">
                ▲ cache-stable · volatile ▼ — nothing above the line may mutate
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* action hardening */}
      <section className="py-16 sm:py-20 border-t hairline">
        <Reveal>
          <SectionHead
            eyebrow="the action plane"
            title="An action is a contract, not a hope"
            lede="Before anything dispatches, the page must be settled and the target must resolve safely; after it lands, page state has to prove it."
          />
        </Reveal>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {HARDENING.map((h, i) => (
            <Reveal key={h.name} delay={i * 100} className="h-full">
              <article className="h-full rounded-sm border hairline bg-surface p-6 flex flex-col">
                <h3 className="font-display text-xl">{h.name}</h3>
                <p className="mt-3 text-[0.84rem] text-ink-2 leading-relaxed">{h.body}</p>
                <p className="mt-auto pt-3 font-mono text-[0.65rem] text-muted">{h.tag}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      {/* repair ladder */}
      <section className="py-16 sm:py-20 border-t hairline">
        <Reveal>
          <SectionHead eyebrow="failure is a first-class path" title="The repair ladder" />
        </Reveal>
        <div className="mt-10 grid gap-5 sm:grid-cols-3">
          {LADDER.map((r, i) => (
            <Reveal key={r.rung} delay={i * 100} className="h-full">
              <article className="h-full rounded-sm border hairline bg-surface p-6">
                <div className="flex items-baseline justify-between">
                  <h3 className="font-display text-xl">{r.rung}</h3>
                  <span className="font-mono text-[0.7rem] text-copper-bright">{r.cost}</span>
                </div>
                <p className="mt-3 text-[0.84rem] text-ink-2 leading-relaxed">{r.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
        <Reveal delay={120}>
          <p className="mt-8 max-w-2xl text-ink-2 leading-relaxed">
            Errors are typed, carry the failing step and run id, and are never
            swallowed into a boolean. A scoped repair costs about one step; a
            blind restart costs the whole task — the ladder exists so it rarely
            gets that far.
          </p>
        </Reveal>
      </section>

      {/* run lifecycle */}
      <section className="py-16 sm:py-20 border-t hairline">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr]">
          <Reveal>
            <p className="eyebrow">the learning plane</p>
            <h2 className="mt-3 font-display text-3xl leading-tight">
              A run&apos;s lifecycle: recorded, verified, promoted, replayed
            </h2>
            <p className="mt-4 text-ink-2 leading-relaxed">
              The recorder is a stdio proxy that tees the tool channel
              unmodified — observationally invisible to both sides — while
              writing an append-only trajectory. Nothing is edited in place,
              ever; a verified run is promoted, and an exact fingerprint match
              replays it without a model in the loop.
            </p>
            <p className="mt-4 font-mono text-[0.72rem] text-muted leading-relaxed">
              .rote/runs/&lt;runId&gt;/
              <br />
              &nbsp;&nbsp;trajectory.jsonl · manifest.json · blobs/
            </p>
          </Reveal>
          <Reveal delay={120}>
            <ol className="relative border-l hairline ml-2">
              {LIFECYCLE.map((s, i) => (
                <li key={s.step} className="relative pl-7 pb-5 last:pb-0">
                  <span className="absolute -left-[5px] top-1.5 w-[9px] h-[9px] rounded-full bg-copper border-2 border-copper" />
                  <span className="font-mono text-[0.85rem] text-ink">
                    {String(i + 1).padStart(2, "0")} {s.step}
                  </span>
                  <span className="ml-3 text-[0.8rem] text-ink-2">{s.note}</span>
                </li>
              ))}
            </ol>
          </Reveal>
        </div>
      </section>

      {/* package map */}
      <section className="py-16 sm:py-20 border-t hairline">
        <Reveal>
          <SectionHead
            eyebrow="the monorepo"
            title="Every arrow points down"
            lede="Ten packages in strict layers: everything may depend on core; core depends on nothing; CI forbids cycles and deep imports."
          />
        </Reveal>
        <Reveal delay={120}>
          <div className="mt-10 max-w-3xl">
            {PKG_LAYERS.map((l, i) => (
              <div key={l.layer} className="relative">
                <div className="grid grid-cols-[6.5rem_1fr] gap-4 items-stretch">
                  <div className="flex items-center">
                    <span className="font-mono text-[0.65rem] tracking-widest uppercase text-muted">
                      {l.layer}
                    </span>
                  </div>
                  <div className="flex gap-3 flex-wrap py-1.5">
                    {l.pkgs.map((p) => (
                      <div
                        key={p.n}
                        className={`rounded-sm border px-4 py-2.5 ${
                          p.n === "core"
                            ? "border-copper/60 bg-copper/[0.08]"
                            : "hairline bg-surface"
                        }`}
                      >
                        <span className={`font-mono text-[0.8rem] ${p.n === "core" ? "text-copper-bright" : "text-ink"}`}>
                          @rote/{p.n}
                        </span>
                        <span className="ml-3 text-[0.75rem] text-ink-2">{p.d}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {i < PKG_LAYERS.length - 1 && (
                  <div className="grid grid-cols-[6.5rem_1fr]" aria-hidden>
                    <div />
                    <div className="pl-8 py-0.5">
                      <svg viewBox="0 0 12 14" className="w-3 h-3.5" fill="none">
                        <path d="M6 0 V10" stroke="rgba(232,226,214,0.25)" strokeWidth="1.2" />
                        <path d="M2 7 L6 12 L10 7" stroke="rgba(232,226,214,0.25)" strokeWidth="1.2" />
                      </svg>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* type spine */}
      <section className="py-16 sm:py-20 border-t hairline">
        <Reveal>
          <SectionHead
            eyebrow="the type spine"
            title="Zod first, types derived"
            lede="Schemas are the single source of truth — every type is z.infer'd, never hand-duplicated. Five of them carry the design."
          />
        </Reveal>
        <Reveal delay={100}>
          <div className="mt-10 overflow-x-auto rounded-sm border hairline">
            <table className="w-full text-[0.87rem] min-w-[40rem]">
              <tbody className="divide-y hairline">
                {TYPES.map((t) => (
                  <tr key={t.t} className="hover:bg-surface/70 transition-colors">
                    <td className="px-4 py-3.5 font-mono text-[0.8rem] text-copper-bright whitespace-nowrap align-top w-44">
                      {t.t}
                    </td>
                    <td className="px-4 py-3.5 text-ink-2 leading-relaxed">{t.d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
