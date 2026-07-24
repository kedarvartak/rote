import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Packages — Rote",
  description:
    "The Rote monorepo: ten TypeScript packages from a zero-I/O core to the CLI, with pure logic in the middle and side effects at the edges.",
};

const PACKAGES = [
  {
    name: "@rote/core",
    plane: "spine",
    what: "Zod schemas, pure data logic, serializers. Zero I/O — everything depends on it, it depends on nothing.",
    api: "TrajectoryEventSchema · PlaybookSchema · ExpectSchema · buildEnvFingerprint · renderTemplate · applyPatch",
  },
  {
    name: "@rote/recorder",
    plane: "learning",
    what: "An observationally-invisible stdio MCP proxy: tees a downstream server unmodified while recording every tools/call as an append-only, fsync-per-event, crash-safe trajectory.",
    api: "runProxy · buildTrajectoryEvent · appendTrajectoryEvent · rote-record",
  },
  {
    name: "@rote/executor",
    plane: "action",
    what: "The replay executor. Walks a playbook's step DAG — deterministic steps cost zero LLM tokens, slot steps one scoped call, judgment steps a closed-enum classification. Checks every expect and the final verify before reporting success.",
    api: "runPlaybook · evaluateExpect · McpToolCaller · rote-replay",
  },
  {
    name: "@rote/browser",
    plane: "perception",
    what: "The browser capture boundary: a static-HTML fixture backend for deterministic tests and a minimal CDP backend for live Chrome.",
    api: "CdpBrowserBackend · captureStaticHtml · FixtureSiteServer",
  },
  {
    name: "@rote/perception",
    plane: "perception",
    what: "Pure perception logic — captured pages become stable, compact observations. Distillation, stable node IDs, exact-reconstruction diffs, and an adaptive full→diff→bootstrap renderer under a 100K-char ceiling.",
    api: "distillPage · renderObservation · diffObservations · renderAdaptiveObservation",
  },
  {
    name: "@rote/action",
    plane: "action",
    what: "Action hardening before dispatch: settledness (zero pending requests plus a quiet DOM window) and self-healing element resolution (stable-ID → role+name → text proximity).",
    api: "waitForSettled · resolveElementTarget · assertBrowserExpect",
  },
  {
    name: "@rote/agent",
    plane: "decision",
    what: "The compact-observation observe→plan→act loop, planner-client agnostic. Assembles the cache-stable context and enforces prefix immutability at runtime.",
    api: "runBrowserAgent · assemblePlannerContext · assertCacheStablePrefix",
  },
  {
    name: "@rote/llm",
    plane: "spine",
    what: "The shared source-tagged LLM boundary — every provider call is attributed (planner|matcher|slot|repair|verify|distill); direct SDK calls outside it fail lint. Routes the immutable prefix's SHA-256 through prompt_cache_key on OpenAI.",
    api: "TaggedLlmClient · OpenAiTaggedLlmClient · openAiPromptCacheKey",
  },
  {
    name: "@rote/bench",
    plane: "learning",
    what: "Deterministic benchmark orchestration and reporting — the launch gate lives here. Failed cells are never dropped; bootstrap CIs and the price table are code, not spreadsheets.",
    api: "runBenchmarkMatrix · buildCurveReport · bootstrapReductionInterval · evaluateLaunchGate",
  },
  {
    name: "@rote/cli",
    plane: "surface",
    what: "The rote command: launch verified cold browser tasks, inspect recorded runs, and promote candidates — preferring exact-fingerprint zero-LLM replay when one matches.",
    api: "rote run · rote runs ls · rote runs show · rote candidate create",
  },
];

export default function PackagesPage() {
  return (
    <article className="pb-20">
      <p className="eyebrow">the monorepo</p>
      <h1 className="mt-3 font-display wonk text-4xl tracking-tight">Packages</h1>
      <p className="mt-5 text-ink-2 leading-relaxed max-w-2xl">
        TypeScript strict, Node ≥ 20, ESM only. Zod schemas are the single
        source of truth for types. Pure logic — pruning, fingerprinting,
        templating, accounting — lives in dependency-free functions so it&apos;s
        property-testable; side effects live at the edges behind narrow
        interfaces. Everything may depend on core; core depends on nothing;
        CI enforces no cycles.
      </p>
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {PACKAGES.map((p) => (
          <article
            key={p.name}
            className="rounded-sm border hairline bg-surface p-5 hover:border-copper/50 transition-colors flex flex-col"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-mono text-[0.9rem] text-copper-bright">{p.name}</h2>
              <span className="font-mono text-[0.6rem] uppercase tracking-widest text-muted border hairline rounded-[2px] px-1.5 py-0.5">
                {p.plane}
              </span>
            </div>
            <p className="mt-3 text-[0.85rem] text-ink-2 leading-relaxed">{p.what}</p>
            <p className="mt-auto pt-3 font-mono text-[0.68rem] text-muted leading-relaxed">
              {p.api}
            </p>
          </article>
        ))}
      </div>
      <p className="mt-8 text-[0.85rem] text-ink-2 leading-relaxed max-w-2xl">
        Designed but absent — the honest gaps:{" "}
        <span className="font-mono text-[0.8rem]">decision</span>,{" "}
        <span className="font-mono text-[0.8rem]">predictor</span>,{" "}
        <span className="font-mono text-[0.8rem]">memory</span>, and{" "}
        <span className="font-mono text-[0.8rem]">mcp-server</span> exist in
        the architecture docs, not in <span className="font-mono text-[0.8rem]">packages/</span>.
      </p>
    </article>
  );
}
