import { appendFile, cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { isAbsolute, join, resolve } from 'node:path';
import { EnterpriseFixtureServer } from '../../../packages/bench/src/enterprise-oracle.js';
import { parseP2CampaignProtocol, type P2CampaignProtocol } from '../../../packages/bench/src/p2-campaign-preflight.js';
import { evaluateP2CampaignGates, renderP2CampaignGateResult, type P2CampaignRunRecord } from '../../../packages/bench/src/p2-campaign-gates.js';
import { planP2Campaign, preflightP2CampaignPlan, type P2CampaignBinding } from '../../../packages/bench/src/p2-campaign-plan.js';
import type { P2CampaignGate } from '../../../packages/bench/src/p2-campaign-preflight.js';
import { readRecordedRun } from '../../../packages/bench/src/run-store.js';
import { DEFAULT_PRICE_TABLE, priceForModel, runCostUsd } from '../../../packages/bench/src/pricing.js';
import { summarizeRoutingCalibration, type RoutingCalibrationSample } from '../../../packages/bench/src/routing-calibration.js';
import type { RunManifest, TrajectoryEvent } from '@rote/core';
import { actionKeyFromEvent, sameAction, type ActionKey } from '@rote/predictor';
import { runPaths } from '@rote/recorder';
import { distillTrajectory, UnparameterizedValueError, type DistillableEvent } from '../../../packages/distiller/src/index.js';

/**
 * Provider-backed P2 collector. The frozen protocol remains declarative; this
 * runner supplies executable bindings for the local fixture corpus and retains
 * every run manifest/trajectory plus the gate records used for evaluation.
 */

const ROOT = resolve(process.cwd());
const DEFAULT_PROTOCOL = resolve(ROOT, 'scripts/bench/p2-campaign/protocol.json');

const values = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const flag = process.argv[i];
  const value = process.argv[i + 1];
  if (!flag?.startsWith('--') || value === undefined) throw new Error('usage: run-provider-campaign.ts [--protocol path] [--out dir] [--repetitions n] [--provider codex|claude-code|openai] [--model model] [--routine-model model] [--gate t0|t2|routing|b4]');
  values.set(flag, value);
}

const protocolPath = resolve(values.get('--protocol') ?? DEFAULT_PROTOCOL);
const outDir = resolve(values.get('--out') ?? join(ROOT, 'bench-out/p2-provider-exit-campaign'));
const repetitions = Number(values.get('--repetitions') ?? '15');
const provider = values.get('--provider') ?? process.env['ROTE_LLM_PROVIDER'] ?? 'codex';
const routineModel = values.get('--routine-model') ?? 'default';
const selectedGate = values.get('--gate') as P2CampaignGate | undefined;
if (selectedGate && !['t0', 't2', 'routing', 'b4'].includes(selectedGate)) throw new Error('--gate must be t0, t2, routing, or b4');
if (!Number.isInteger(repetitions) || repetitions < 1) throw new Error('--repetitions must be a positive integer');

const sourceProtocol = parseP2CampaignProtocol(JSON.parse(await readFile(protocolPath, 'utf8')));
const model = values.get('--model') ?? (provider === 'openai' ? sourceProtocol.model : 'default');
// The frozen contract requires 15 repetitions; smaller values are intentionally
// supported only for a smoke run and are reported as not_certifiable by the gate.
const protocol = { ...sourceProtocol, provider, model, repetitions_per_cell: repetitions } as P2CampaignProtocol;

await mkdir(outDir, { recursive: true });
const fixtureRoot = join(outDir, 'fixture-root');
await mkdir(fixtureRoot, { recursive: true });
await cp(resolve(ROOT, 'fixtures/enterprise'), fixtureRoot, { recursive: true, force: false }).catch(() => undefined);
await cp(resolve(ROOT, 'fixtures/sites'), fixtureRoot, { recursive: true, force: false }).catch(() => undefined);

const server = new EnterpriseFixtureServer(fixtureRoot);
await server.start();
const baseUrl = server.url('/');

// T0 is a paired same-task/new-parameter comparison. Every repetition gets a
// fresh value set, while the parameter names stay fixed so the distilled
// playbook can match and substitute them without persisting literals.
const t0Cases = Array.from({ length: repetitions }, (_, index) => {
  const n = String(index + 1).padStart(2, '0');
  return {
    company_name: `Acme Tools ${n}`,
    contact_email: `ops+${n}@acme.example`,
    tax_id: `TAX-${100 + index}`,
    address_line1: `${index + 1} Main St`,
    city: index % 2 === 0 ? 'Austin' : 'Dallas',
    postal_code: index % 2 === 0 ? '78701' : '75201',
    country: 'US',
    phone: `512555${String(1000 + index).slice(-4)}`,
  };
});
const t0PromptsByRepetition = Object.fromEntries(t0Cases.map((params, index) => [String(index + 1),
  `Register a vendor with company name ${params.company_name}, contact email ${params.contact_email}, tax ID ${params.tax_id}, address line 1 ${params.address_line1}, city ${params.city}, postal code ${params.postal_code}, country ${params.country}, and phone ${params.phone}, then submit the registration.`]));
const t0ParamsByRepetition = Object.fromEntries(t0Cases.map((params, index) => [String(index + 1), params]));
const novelParams = {
  company_name: 'Northwind Supply', contact_email: 'intake@northwind.example', tax_id: 'TAX-987',
  address_line1: '99 Market St', city: 'Denver', postal_code: '80202', country: 'US', phone: '3035550199',
};
const bindings: P2CampaignBinding[] = [
  {
    cellId: 't0-distillation-repeat', taskId: 'B2',
    prompt: t0PromptsByRepetition['1']!,
    path: 'b2-vendor-form.html', verifyText: 'Vendor registration complete', params: t0Cases[0]!,
    promptsByRepetition: t0PromptsByRepetition, paramsByRepetition: t0ParamsByRepetition,
  },
  {
    cellId: 't2-novel-known-site', taskId: 'B2N',
    prompt: 'For the quarterly supplier onboarding audit, populate the vendor intake portal for Northwind Supply using contact intake@northwind.example, tax ID TAX-987, address line 1 99 Market St, city Denver, postal code 80202, country US, and phone 3035550199, then submit it.',
    path: 'b2-vendor-form.html', verifyText: 'Vendor registration complete', params: novelParams,
  },
  {
    cellId: 'routing-predictor-real-page', taskId: 'B2-routing',
    prompt: 'Onboard a supplier in the registration portal: enter company name Contoso Logistics, contact email hello@contoso.example, tax ID TAX-555, address line 1 7 Lake Ave, city Boston, postal code 02108, country US, and phone 6175550111, then submit the form.',
    path: 'b2-vendor-form.html', verifyText: 'Vendor registration complete', params: { ...novelParams, company_name: 'Contoso Logistics', contact_email: 'hello@contoso.example', tax_id: 'TAX-555', address_line1: '7 Lake Ave', city: 'Boston', postal_code: '02108', phone: '6175550111' },
  },
  {
    cellId: 'b4-long-run-economics', taskId: 'B4',
    prompt: 'Complete exactly 60 single-session SPA transitions. Click the visible Advance transition button once per step until the UI says transition 60 complete. Then return done with success true.',
    path: 'spa-endurance.html', verifyText: 'UI says transition 60 complete', params: {},
  },
];

const plan = planP2Campaign(protocol, { baseUrl, bindings, routineModel, routeMinConfidence: 0.9, siteBriefChars: 1200 });
const problems = preflightP2CampaignPlan(plan, { baseUrl, bindings, routineModel, routeMinConfidence: 0.9, siteBriefChars: 1200 });
if (problems.length > 0) throw new Error(problems.map((problem) => `${problem.code}: ${problem.detail}`).join('\n'));
const judgmentGate = verifyJudgmentDistillationGuard();
// Selected gates still receive prerequisite T0 learning phases. Otherwise T2
// and routing would measure an empty-memory site instead of a known site.
const executionPhases = selectedGate
  ? plan.phases.filter((phase) => phase.gate === selectedGate || (selectedGate !== 'b4' && phase.gate === 't0'))
  : plan.phases;

const baseDir = join(outDir, '.rote');
await mkdir(join(outDir, 'manifests'), { recursive: true });
await mkdir(join(outDir, 'receipts'), { recursive: true });
const evidenceDir = join(outDir, 'evidence');
await mkdir(evidenceDir, { recursive: true });
const rawJsonl = join(outDir, 'raw.jsonl');
const records: P2CampaignRunRecord[] = [];
const phaseResults: Array<Record<string, unknown>> = [];
const routingSamples: RoutingCalibrationSample[] = [];
const routingSiteSteps = new Map<string, number>();
let routingTotalSteps = 0;

for (const phase of executionPhases) {
  for (const run of phase.runs) {
    server.reset();
    if (phase.kind === 'distill') {
      await runCommand(run.command, run.args, { ...run.env, ROTE_BASE_DIR: baseDir, ROTE_LLM_PROVIDER: provider });
      phaseResults.push({ phase: phase.id, run: run.runId, success: true });
      continue;
    }
    const args = provider === 'codex' || provider === 'claude-code'
      ? run.args.filter((arg, index, all) => !(arg === '--model' && all[index + 1] === 'default') && !(index > 0 && all[index - 1] === '--model' && arg === 'default'))
      : run.args;
    const result = await runRecordedCommand(args, {
      ...run.env,
      ROTE_BASE_DIR: baseDir,
      ROTE_LLM_PROVIDER: provider,
      ROTE_RUN_ID: run.runId,
    }, baseDir, run.runId);
    const recorded = await readRecordedRun(baseDir, result.runId);
    const cliTelemetry = parseCliTelemetry(result.stdout);
    const metrics = measureManifest(recorded.manifest, model);
    const usages = recorded.manifest.token_usage;
    const logicalInput = usages.reduce((sum, usage) => sum + usage.input_tokens + usage.cache_read_tokens + usage.cache_write_tokens, 0);
    const events = recorded.trajectory;
    const agentEvents = events.filter((event) => event.tool.startsWith('browser.'));
    const eventResults = await Promise.all(agentEvents.map((event) => readEventResult(baseDir, result.runId, event)));
    const routeEvents = eventResults
      .map((value) => routeFromResult(value))
      .filter((route): route is { planner: 'routine' | 'frontier'; reason: string; escalated?: string } => route !== undefined);
    const routeTelemetryComplete = phase.kind !== 'routing_on' || routeEvents.length === agentEvents.length;
    const routingRun = phase.gate === 'routing' ? await collectRoutingTelemetry(run.runId, run.repetition, phase.kind, agentEvents, eventResults, routingSamples, routingSiteSteps) : undefined;
    if (phase.gate === 'routing') routingTotalSteps += agentEvents.length;
    const warmSteps = phase.kind === 'routing_on'
      ? (routeTelemetryComplete ? routeEvents.length : undefined)
      : phase.kind === 'routing_off' ? agentEvents.length : undefined;
    const frontierSteps = phase.kind === 'routing_on'
      ? (routeTelemetryComplete ? routeEvents.filter((route) => route.planner === 'frontier').length : undefined)
      : phase.kind === 'routing_off' ? agentEvents.length : undefined;
    const transitions = phase.kind === 'endurance' ? events.filter((event) => event.tool === 'browser.click').length : undefined;
    records.push({
      cell_id: phase.cellId, gate: phase.gate, phase_kind: phase.kind, repetition: run.repetition,
      success: recorded.manifest.outcome === 'success', logical_input_tokens: logicalInput,
      ...(warmSteps !== undefined ? { warm_steps: warmSteps } : {}),
      ...(frontierSteps !== undefined ? { frontier_steps: frontierSteps } : {}),
      ...(routingRun ? {
        routine_steps: routingRun.routine_steps,
        escalations: routingRun.escalations,
        prediction_steps: routingRun.prediction_steps,
        prediction_hits: routingRun.prediction_hits,
        prediction_confidence_sum: routingRun.prediction_confidence_sum,
      } : {}),
      ...(transitions !== undefined ? { transitions } : {}), pricing_table: sourceProtocol.pricing_table,
      ...(cliTelemetry.brief ? { brief_chars: cliTelemetry.brief.chars, brief_hinted: cliTelemetry.brief.hinted, brief_used: cliTelemetry.brief.used } : {}),
      ...(cliTelemetry.matcherDurationMs !== undefined ? { matcher_duration_ms: cliTelemetry.matcherDurationMs } : {}),
      ...(cliTelemetry.selectionMatched !== undefined ? { selection_matched: cliTelemetry.selectionMatched } : {}),
    });
    const phaseResult = {
      phase: phase.id, run: run.runId, success: result.ok && recorded.manifest.outcome === 'success', outcome: recorded.manifest.outcome,
      ...metrics, logical_input_tokens: logicalInput,
      ...(warmSteps !== undefined ? { warm_steps: warmSteps } : {}),
      ...(frontierSteps !== undefined ? { frontier_steps: frontierSteps } : {}),
      ...(routingRun ? { routing: routingRun } : {}),
      ...(transitions !== undefined ? { transitions } : {}),
      ...(cliTelemetry.brief ? { brief: cliTelemetry.brief } : {}),
      ...(cliTelemetry.matcherDurationMs !== undefined ? { matcher_duration_ms: cliTelemetry.matcherDurationMs } : {}),
      ...(cliTelemetry.selectionMatched !== undefined ? { selection_matched: cliTelemetry.selectionMatched } : {}),
    };
    phaseResults.push(phaseResult);
    await appendFile(rawJsonl, `${JSON.stringify({ protocol_id: sourceProtocol.protocol_id, provider, model, ...phaseResult })}\n`, 'utf8');
    await writeFile(join(outDir, 'manifests', `${run.runId}.json`), `${JSON.stringify(recorded.manifest, null, 2)}\n`, 'utf8');
    await writeFile(join(outDir, 'receipts', `${run.runId}.json`), `${JSON.stringify(recorded.trajectory, null, 2)}\n`, 'utf8');
  }
}

const gateResult = evaluateP2CampaignGates(sourceProtocol, records);
await writeFile(join(outDir, 'records.json'), `${JSON.stringify(records, null, 2)}\n`, 'utf8');
const t0Gate = gateResult.gates.find((gate) => gate.gate === 't0');
await writeFile(join(evidenceDir, 't0.json'), `${JSON.stringify({
  protocol_id: sourceProtocol.protocol_id,
  selected_gate: selectedGate ?? 'all',
  provider,
  model,
  gate: t0Gate,
  judgment_gate: judgmentGate,
  paired_repetitions: phaseResults.filter((phase) => typeof phase.phase === 'string' && (phase.phase as string).startsWith('t0-distillation-repeat-')),
  distillation: { deterministic: true, billed_provider_calls: 0 },
}, null, 2)}\n`, 'utf8');
const t2Gate = gateResult.gates.find((gate) => gate.gate === 't2');
await writeFile(join(evidenceDir, 't2.json'), `${JSON.stringify({
  protocol_id: sourceProtocol.protocol_id,
  selected_gate: selectedGate ?? 'all',
  provider,
  model,
  gate: t2Gate,
  paired_repetitions: phaseResults.filter((phase) => typeof phase.phase === 'string' && (phase.phase as string).startsWith('t2-novel-known-site-')),
  brief_telemetry: phaseResults.filter((phase) => typeof phase.phase === 'string' && (phase.phase as string).startsWith('t2-novel-known-site-')).map((phase) => ({ phase: phase.phase, run: phase.run, brief: phase.brief, matcher_duration_ms: phase.matcher_duration_ms, selection_matched: phase.selection_matched })),
}, null, 2)}\n`, 'utf8');
const routingGate = gateResult.gates.find((gate) => gate.gate === 'routing');
const routingEvidence = summarizeRoutingCalibration(routingSamples, routingTotalSteps, Object.fromEntries(routingSiteSteps));
await writeFile(join(evidenceDir, 'routing.json'), `${JSON.stringify({
  protocol_id: sourceProtocol.protocol_id,
  selected_gate: selectedGate ?? 'all',
  provider,
  model,
  gate: routingGate,
  paired_repetitions: phaseResults.filter((phase) => typeof phase.phase === 'string' && ((phase.phase as string).startsWith('routing-predictor-real-page-routing-off-') || (phase.phase as string).startsWith('routing-predictor-real-page-routing-on-'))),
  samples: routingSamples,
  calibration: routingEvidence,
  value_free_contract: { action_target: 'kind plus stable identity, selector, or URL path; no typed values', site_key: 'page identity digest' },
}, null, 2)}\n`, 'utf8');
await writeFile(join(outDir, 'summary.json'), `${JSON.stringify({ protocol: sourceProtocol, provider, model, repetitions, selected_gate: selectedGate ?? 'all', plan: executionPhases.map((phase) => ({ id: phase.id, kind: phase.kind, runs: phase.runs.length })), phaseResults, gateResult }, null, 2)}\n`, 'utf8');
console.log(renderP2CampaignGateResult(gateResult));
console.log(`artifacts: ${outDir}`);
await server.close();

async function runCommand(command: string, args: string[], env: Record<string, string>): Promise<void> {
  const result = await spawnAndCollect(command, args, env);
  if (!result.ok) throw new Error(`${command} ${args.join(' ')} failed: ${result.error}`);
}

async function readEventResult(baseDir: string, runId: string, event: TrajectoryEvent): Promise<unknown> {
  if (event.result_ref.kind === 'inline') return event.result_ref.value;
  const blobPath = isAbsolute(event.result_ref.path) ? event.result_ref.path : join(runPaths(baseDir, runId).runDir, event.result_ref.path);
  try { return JSON.parse(await readFile(blobPath, 'utf8')) as unknown; } catch { return undefined; }
}

function routeFromResult(value: unknown): { planner: 'routine' | 'frontier'; reason: string; escalated?: string } | undefined {
  if (!isRecord(value) || !isRecord(value.route)) return undefined;
  const planner = value.route.planner;
  const reason = value.route.reason;
  if ((planner !== 'routine' && planner !== 'frontier') || typeof reason !== 'string') return undefined;
  return { planner, reason, ...(typeof value.route.escalated === 'string' ? { escalated: value.route.escalated } : {}) };
}

async function collectRoutingTelemetry(
  runId: string,
  repetition: number,
  phaseKind: 'routing_off' | 'routing_on',
  events: readonly TrajectoryEvent[],
  results: readonly unknown[],
  samples: RoutingCalibrationSample[],
  siteSteps: Map<string, number>,
): Promise<{ routine_steps: number; escalations: number; prediction_steps: number; prediction_hits: number; prediction_confidence_sum: number; missing_route_steps: number }> {
  let routine_steps = 0;
  let escalations = 0;
  let prediction_steps = 0;
  let prediction_hits = 0;
  let prediction_confidence_sum = 0;
  let missing_route_steps = 0;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    const value = results[index];
    const route = routeFromResult(value);
    if (route?.planner === 'routine') routine_steps += 1;
    if (route?.escalated) escalations += 1;
    if (!route && phaseKind === 'routing_on') missing_route_steps += 1;
    const siteKey = isRecord(value) && typeof value.page_key === 'string' && value.page_key.length > 0 ? value.page_key : 'unknown';
    siteSteps.set(siteKey, (siteSteps.get(siteKey) ?? 0) + 1);
    const prediction = isRecord(value) && isRecord(value.prediction) ? value.prediction : undefined;
    if (!prediction || typeof prediction.confidence !== 'number' || typeof prediction.source !== 'string' || typeof prediction.hit !== 'boolean') continue;
    if (prediction.confidence < 0 || prediction.confidence > 1) continue;
    const actual = actionKeyFromEvent(event);
    const predicted = actionKeyFromValue(prediction.predicted);
    const hit = prediction.hit && sameAction(predicted, actual);
    prediction_steps += 1;
    if (hit) prediction_hits += 1;
    prediction_confidence_sum += prediction.confidence;
    samples.push({
      run_id: runId, phase_kind: phaseKind, repetition, step: event.seq, site_key: siteKey,
      source: prediction.source, confidence: prediction.confidence,
      action_kind: actual.kind, action_target: actual.target,
      ...(predicted ? { predicted_kind: predicted.kind, predicted_action_target: predicted.target } : {}), hit,
    });
  }
  return { routine_steps, escalations, prediction_steps, prediction_hits, prediction_confidence_sum, missing_route_steps };
}

function actionKeyFromValue(value: unknown): ActionKey | undefined {
  if (!isRecord(value) || typeof value.kind !== 'string' || typeof value.target !== 'string') return undefined;
  return { kind: value.kind, target: value.target };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function runRecordedCommand(args: string[], env: Record<string, string>, base: string, runId: string): Promise<{ ok: boolean; runId: string; stdout: string; error?: string }> {
  const child = spawn('node', args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  let stdout = '';
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
  const started = Date.now();
  let killedAfterRecord = false;
  const runRoot = join(base, 'runs');
  const runIdsBefore = new Set(await readdir(runRoot).catch(() => []));
  let recordedRunId = runId;
  const done = new Promise<{ ok: boolean; error?: string }>((resolveDone) => {
    child.on('error', (error) => resolveDone({ ok: false, error: error.message }));
    child.on('close', (code, signal) => resolveDone(code === 0 ? { ok: true } : { ok: false, error: `exit ${signal ?? code}: ${stderr.trim()}` }));
  });
  while (Date.now() - started < 20 * 60_000) {
    if (!killedAfterRecord) {
      if (existsSync(join(runRoot, runId, 'manifest.json'))) recordedRunId = runId;
      else {
        const candidates = (await readdir(runRoot).catch(() => []))
          .filter((candidate) => !runIdsBefore.has(candidate))
          .find((candidate) => existsSync(join(runRoot, candidate, 'manifest.json')));
        if (candidates) recordedRunId = candidates;
      }
    }
    if (existsSync(join(runRoot, recordedRunId, 'manifest.json')) && !killedAfterRecord) {
      // The CLI writes the complete manifest before Chromium teardown. A short
      // grace period lets the final trajectory append flush; bounded termination
      // avoids an otherwise unbounded CDP close on long provider campaigns.
      killedAfterRecord = true;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
      child.kill('SIGTERM');
    }
    const finished = await Promise.race([done, new Promise<undefined>((resolveDelay) => setTimeout(() => resolveDelay(undefined), 250))]);
    if (finished) {
      const manifestExists = existsSync(join(runRoot, recordedRunId, 'manifest.json'));
      return manifestExists
        ? { ok: true, runId: recordedRunId, stdout }
        : { ...finished, runId, stdout };
    }
  }
  child.kill('SIGTERM');
  return { ok: false, runId: recordedRunId, stdout, error: `timed out after 20 minutes${stderr ? `: ${stderr.trim()}` : ''}` };
}

function parseCliTelemetry(stdout: string): {
  matcherDurationMs?: number;
  selectionMatched?: boolean;
  brief?: { chars: number; hinted: number; used: number };
} {
  const matcher = stdout.match(/^matcher:\s+(\d+)\s+ms$/m);
  const selection = stdout.match(/^selection:\s+(.+)$/m)?.[1] ?? '';
  const brief = stdout.match(/^site brief:\s+(\d+) chars, (\d+)\/(\d+) hints used$/m);
  return {
    ...(matcher ? { matcherDurationMs: Number(matcher[1]) } : {}),
    ...(selection ? { selectionMatched: selection.startsWith('library match ') } : {}),
    ...(brief ? { brief: { chars: Number(brief[1]), used: Number(brief[2]), hinted: Number(brief[3]) } } : {}),
  };
}

function spawnAndCollect(command: string, args: string[], env: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.stdout.resume();
    child.on('error', (error) => resolveResult({ ok: false, error: error.message }));
    child.on('close', (code, signal) => resolveResult(code === 0 ? { ok: true } : { ok: false, error: `exit ${signal ?? code}: ${stderr.trim()}` }));
  });
}

function measureManifest(manifest: RunManifest, modelName: string): Record<string, unknown> {
  const totals = manifest.token_usage.reduce((sum, usage) => ({
    input_tokens: sum.input_tokens + usage.input_tokens,
    cache_read_tokens: sum.cache_read_tokens + usage.cache_read_tokens,
    cache_write_tokens: sum.cache_write_tokens + usage.cache_write_tokens,
    output_tokens: sum.output_tokens + usage.output_tokens,
  }), { input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0 });
  const sourceTotals = Object.fromEntries([...new Set(manifest.token_usage.map((usage) => usage.source))].map((source) => [
    source,
    manifest.token_usage.filter((usage) => usage.source === source).reduce((sum, usage) => sum + usage.input_tokens + usage.cache_read_tokens + usage.cache_write_tokens + usage.output_tokens, 0),
  ]));
  const price = priceForModel(modelName, DEFAULT_PRICE_TABLE);
  return {
    duration_ms: manifest.ended_at ? Math.max(0, Date.parse(manifest.ended_at) - Date.parse(manifest.started_at)) : null,
    token_buckets: totals,
    source_totals: sourceTotals,
    cost_usd: price ? runCostUsd(totals.input_tokens, totals.output_tokens, price, totals.cache_read_tokens, totals.cache_write_tokens) : null,
    cost_status: price ? 'priced' : 'unpriced_model',
  };
}

/** T0's scope includes the B4 negative control: judgment values must not teach a playbook. */
function verifyJudgmentDistillationGuard(): { passed: boolean; classification: string; step_id?: string } {
  const event = (seq: number, tool: string, args: Record<string, unknown>, result: unknown): DistillableEvent => ({
    event: {
      run_id: 'p2-b4-guard', seq, ts: '2026-10-23T00:00:00.000Z', tool, args,
      result_digest: { sha256: '0'.repeat(64), byte_length: 1, preview: '' },
      result_ref: { kind: 'inline', value: result }, duration_ms: 1,
    }, result,
  });
  const strong = (action_kind: string) => ({ post_action_evidence: {
    action_kind, strength: 'strong', classification: 'exact_effect_observed', passed: true, enforced: true,
  }, resolution: { selector: '#triage-category', strategy: 'stable-id', stableId: 'v2:b4c47e0a91d2f356' } });
  const trajectory: DistillableEvent[] = [
    event(0, 'browser.navigate', { kind: 'navigate', url: 'https://fixture.test/b4-triage.html?item=TKT-1041' }, { post_action_evidence: { action_kind: 'navigate', strength: 'strong', classification: 'exact_effect_observed', passed: true, enforced: true } }),
    event(1, 'browser.select', { kind: 'select', selector: '#triage-category', role: 'combobox', name: 'Category', value: 'billing' }, strong('select')),
    event(2, 'browser.done', { kind: 'done', success: true, summary: 'routed' }, {}),
  ];
  try {
    distillTrajectory(trajectory, {
      playbookName: 'p2-b4-judgment-guard', intentDescription: 'Triage support item {{item_id}}',
      envFingerprint: { domain: 'fixture.test', tool_prefixes: ['browser.'] },
      params: [{ name: 'item_id', type: 'string', value: 'TKT-1041' }],
      verify: [{ text_visible: 'Item routed' }],
    });
    throw new Error('judgment value was accepted as a literal');
  } catch (error) {
    if (!(error instanceof UnparameterizedValueError)) throw error;
    return { passed: true, classification: error.name, step_id: error.stepId };
  }
}
