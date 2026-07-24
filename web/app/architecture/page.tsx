import type { Metadata } from "next";
import { Reveal } from "@/components/Reveal";

export const metadata: Metadata = {
  title: "Architecture — Rote",
  description:
    "The memory spine, the four planes, the control loop, the context assembler, and the repair ladder — how Rote manages a browser agent's context window.",
};

const PLANES = [
  {
    name: "Perception",
    body: "Capture pages via CDP, distill them to compact interactive trees, assign stable element IDs, and send diffs instead of full page dumps.",
  },
  {
    name: "Decision",
    body: "Own the context layout, route routine steps to cheaper models, and skip model calls entirely when memory or replay can safely act.",
  },
  {
    name: "Action",
    body: "Typed browser actions with settledness detection, self-healing element resolution, per-step assertions, and — later — speculative pre-execution.",
  },
  {
    name: "Learning",
    body: "Record every run; learn playbooks, site memory, and transition models; feed them back into replay, hints, resolution, and prediction.",
  },
];

const LOOP = [
  { step: "fingerprint", note: "hard gate — never cross environments", built: true },
  { step: "match playbook", note: "semantic match + bind", built: false },
  { step: "replay if confident", note: "deterministic steps cost zero LLM tokens", built: true },
  { step: "settle", note: "zero pending requests + a quiet DOM window", built: true },
  { step: "observe", note: "distill → stable IDs → budget", built: true },
  { step: "diff-encode", note: "A4 — median diff 24 chars on real pages", built: true },
  { step: "decide", note: "planner call over the assembled context", built: true },
  { step: "dispatch & record", note: "typed action, append-only trajectory", built: true },
  { step: "expect check", note: "per-step assertion on page state", built: true },
  { step: "repair ladder", note: "retry → scoped repair → clean fallback", built: true },
  { step: "verify gate", note: "final checks decide success — never exceptions", built: true },
];

const LAYOUT = [
  {
    zone: "Immutable prefix",
    tokens: "~268 tok",
    body: "System prompt, task, tool schemas. Nothing above this line may ever mutate — not a timestamp, not a run id. SHA-256 of the prefix routes through prompt_cache_key.",
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

const LADDER = [
  {
    rung: "Retry",
    cost: "≈ free",
    body: "Transient failures — a settle-and-retry with no model involvement.",
  },
  {
    rung: "Scoped repair",
    cost: "≈ one step",
    body: "One model call over a narrow context; emits a versioned patch, never an in-place edit.",
  },
  {
    rung: "Fallback",
    cost: "one full run",
    body: "The plain agent takes over, the run is recorded, the failure is re-learned. A blind restart costs the whole task; the ladder rarely gets that far.",
  },
];

const DIAGRAMS = [
  { src: "/diagrams/architecture.svg", caption: "The system at a glance — solid is built, dashed is designed" },
  { src: "/diagrams/tier0-curve.svg", caption: "The O(n²) bill and the four tier-0 levers" },
  { src: "/diagrams/perception-pipeline.svg", caption: "Perception: capture → distill → stable IDs → render budget" },
  { src: "/diagrams/run-lifecycle.svg", caption: "A run's lifecycle through the recorder and the store" },
  { src: "/diagrams/repair-ladder.svg", caption: "The repair ladder — retry, scoped repair, clean fallback" },
  { src: "/diagrams/package-map.svg", caption: "The monorepo: everything depends on core; core depends on nothing" },
];

export default function ArchitecturePage() {
  return (
    <div className="mx-auto max-w-6xl px-5 sm:px-8">
      {/* header */}
      <header className="pt-16 sm:pt-24 pb-12 border-b hairline">
        <Reveal>
          <p className="eyebrow">docs/02 · architecture</p>
          <h1 className="mt-4 font-display wonk text-4xl sm:text-5xl tracking-tight leading-[1.08] max-w-3xl">
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

      {/* four planes */}
      <section className="py-16 sm:py-20">
        <Reveal>
          <p className="eyebrow">where the code lives</p>
          <h2 className="mt-3 font-display wonk text-3xl">The four planes</h2>
        </Reveal>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PLANES.map((p, i) => (
            <Reveal key={p.name} delay={i * 90} className="h-full">
              <article className="h-full rounded-sm border hairline bg-surface p-5 hover:border-copper/50 transition-colors">
                <h3 className="font-display text-xl">{p.name}</h3>
                <p className="mt-2 text-[0.84rem] text-ink-2 leading-relaxed">{p.body}</p>
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
            <h2 className="mt-3 font-display wonk text-3xl leading-tight">
              Replay when confident, plan when not, verify always
            </h2>
            <p className="mt-4 text-ink-2 leading-relaxed">
              The loop below is the actual execution order — a hard
              environment gate first, memory next, the model last. Deterministic
              replay steps cost zero LLM tokens; every exit path ends at the
              verify gate. Compression shrinks a step;{" "}
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
                      s.built
                        ? "bg-copper border-copper"
                        : "bg-bg border-muted"
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

      {/* context assembler */}
      <section className="py-16 sm:py-20 border-t hairline">
        <div className="grid gap-12 lg:grid-cols-2 items-start">
          <Reveal>
            <p className="eyebrow">the context assembler</p>
            <h2 className="mt-3 font-display wonk text-3xl leading-tight">
              One module owns the layout
            </h2>
            <p className="mt-4 text-ink-2 leading-relaxed">
              The ContextAssembler is the only module allowed to order
              messages. Tests fail if any volatile token — a timestamp, a run
              id — lands above the stable line. That discipline is what makes
              the prefix cache-eligible: the 50 lines of cache plumbing are
              trivial; the discipline is not.
            </p>
            <p className="mt-4 text-ink-2 leading-relaxed">
              With eviction on, a step adds ~37 tokens instead of ~172 — the
              quadratic term belongs to observations, and observations don&apos;t
              accumulate.
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

      {/* repair ladder */}
      <section className="py-16 sm:py-20 border-t hairline">
        <Reveal>
          <p className="eyebrow">failure is a first-class path</p>
          <h2 className="mt-3 font-display wonk text-3xl">The repair ladder</h2>
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
            swallowed into a boolean. Fallback paths log{" "}
            <i>why</i> they fired, not just that they did — invariant II
            depends on it.
          </p>
        </Reveal>
      </section>

      {/* diagrams */}
      <section className="py-16 sm:py-20 border-t hairline">
        <Reveal>
          <p className="eyebrow">docs/diagrams · from the design constitution</p>
          <h2 className="mt-3 font-display wonk text-3xl">The notebook pages</h2>
          <p className="mt-4 text-ink-2 max-w-2xl leading-relaxed">
            Hand-drawn with the rest of the design docs and regenerated when
            the architecture changes — a stale diagram is a bug. Solid strokes
            are built; dashed strokes are designed.
          </p>
        </Reveal>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {DIAGRAMS.map((d, i) => (
            <Reveal key={d.src} delay={(i % 2) * 100}>
              <figure className="rounded-sm border hairline overflow-hidden bg-paper">
                <img
                  src={d.src}
                  alt={d.caption}
                  className="w-full h-auto p-4"
                  loading="lazy"
                />
                <figcaption className="px-4 py-3 border-t border-paper-ink/10 text-[0.78rem] text-paper-ink/80 bg-paper">
                  {d.caption}
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </section>
    </div>
  );
}
