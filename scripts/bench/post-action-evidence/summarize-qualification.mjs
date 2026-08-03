import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const input = resolve(process.argv[2] ?? 'bench-out/post-action-evidence-qualification/evidence');
const reportPath = resolve(process.argv[3] ?? `${input}/report.md`);
const summaryPath = resolve(process.argv[4] ?? `${input}/summary.json`);
const protocolPath = resolve(process.argv[5] ?? 'scripts/bench/post-action-evidence/protocol.json');
const [rawRuns, manifests, trajectoryText, protocol] = await Promise.all([
  readJson(resolve(input, 'raw-runs.json')),
  readJson(resolve(input, 'manifests.json')),
  readFile(resolve(input, 'trajectories.jsonl'), 'utf8'),
  readJson(protocolPath),
]);
const events = trajectoryText.split('\n').filter(Boolean).map((line) => JSON.parse(line));
const expectedIds = new Set(protocol.tasks.flatMap((task) => Array.from(
  { length: protocol.repetitions },
  (_, index) => `g2-rote-${task.toLowerCase()}-r${String(index + 1).padStart(2, '0')}`,
)));
assertIdentities('manifests', manifests.map((manifest) => manifest.run_id), expectedIds);
assertIdentities('trajectory runs', [...new Set(events.map((event) => event.run_id))], expectedIds);
assertIdentities('raw runs', rawRuns.map((run) => `g2-rote-${run.task.toLowerCase()}-r${String(run.repetition).padStart(2, '0')}`), expectedIds);

let providerReceipts = 0;
let strongEffects = 0;
let clickReactions = 0;
let doneActions = 0;
for (const manifest of manifests) {
  if (manifest.outcome !== 'success') throw new Error(`${manifest.run_id} did not pass independent verification`);
  const runEvents = events.filter((event) => event.run_id === manifest.run_id);
  const eventUsage = [];
  for (const event of runEvents) {
    if (event.error) throw new Error(`${manifest.run_id}/${event.seq} retained action error: ${event.error.message}`);
    const value = event.result_ref?.kind === 'inline' ? event.result_ref.value : undefined;
    if (!value || Array.isArray(value.planner_usage) || value.planner_usage?.source !== 'planner') {
      throw new Error(`${manifest.run_id}/${event.seq} has missing or repair-tagged planner usage`);
    }
    if (!Array.isArray(value.provider_receipts) || value.provider_receipts.length !== 1) {
      throw new Error(`${manifest.run_id}/${event.seq} must retain exactly one provider receipt`);
    }
    const normalized = normalizeOpenAi(value.provider_receipts[0], `${manifest.run_id}/${event.seq}`);
    const usage = pickUsage(value.planner_usage);
    if (JSON.stringify(normalized) !== JSON.stringify(usage)) {
      throw new Error(`${manifest.run_id}/${event.seq} usage does not reconcile to its provider receipt`);
    }
    providerReceipts += 1;
    eventUsage.push(usage);
    const evidence = value.post_action_evidence;
    if (event.tool === 'browser.done') {
      if (evidence !== undefined) throw new Error(`${manifest.run_id}/${event.seq} done action has post-action evidence`);
      doneActions += 1;
    } else if (event.tool === 'browser.click') {
      if (evidence?.classification !== 'click_reaction_observed' || evidence.enforced !== false) {
        throw new Error(`${manifest.run_id}/${event.seq} click reaction was absent or enforced`);
      }
      clickReactions += 1;
    } else if (!evidence || evidence.classification !== 'exact_effect_observed' || evidence.passed !== true || evidence.enforced !== true) {
      throw new Error(`${manifest.run_id}/${event.seq} strong effect did not pass`);
    } else {
      strongEffects += 1;
    }
  }
  const manifestUsage = manifest.token_usage.map(pickUsage);
  if (JSON.stringify(eventUsage) !== JSON.stringify(manifestUsage)) {
    throw new Error(`${manifest.run_id} manifest usage does not preserve one planner call per action`);
  }
  const task = manifest.run_id.slice('g2-rote-'.length, 'g2-rote-b1'.length).toUpperCase();
  const repetition = Number(manifest.run_id.slice(-2));
  const raw = rawRuns.find((run) => run.task === task && run.repetition === repetition);
  const total = eventUsage.reduce(addUsage, zeroUsage());
  if (!raw || raw.outcome !== 'success' || JSON.stringify(pickUsage(raw)) !== JSON.stringify(total)) {
    throw new Error(`${manifest.run_id} raw row does not reconcile to manifest usage`);
  }
}

const tasks = protocol.tasks.map((task) => {
  const runs = rawRuns.filter((run) => run.task === task);
  const logical = runs.map((run) => run.input_tokens + run.cache_read_tokens + run.cache_write_tokens + run.output_tokens);
  return {
    task,
    successes: runs.filter((run) => run.outcome === 'success').length,
    attempts: runs.length,
    mean_logical_tokens: logical.reduce((sum, value) => sum + value, 0) / logical.length,
  };
});
const summary = {
  schema_version: 1,
  protocol_id: protocol.protocol_id,
  rote_commit: protocol.rote_commit,
  provider: protocol.provider,
  model: protocol.model,
  tasks,
  total_attempts: rawRuns.length,
  total_successes: rawRuns.filter((run) => run.outcome === 'success').length,
  planner_calls: events.length,
  repair_calls: 0,
  provider_receipts: providerReceipts,
  strong_effects_observed: strongEffects,
  click_reactions_observed: clickReactions,
  done_actions: doneActions,
  click_policy: protocol.click_policy,
};
const report = render(summary);
await Promise.all([
  writeFile(reportPath, report),
  writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`),
]);
console.log(`post-action evidence qualification: ${summary.total_successes}/${summary.total_attempts} exact successes, ${providerReceipts} receipts audited`);

function render(value) {
  const rows = value.tasks.map((task) => `| ${task.task} | ${task.successes}/${task.attempts} | ${task.mean_logical_tokens.toFixed(1)} |`).join('\n');
  return `# Post-action evidence qualification\n\nProtocol \`${value.protocol_id}\`; Rote \`${value.rote_commit.slice(0, 12)}\`; ${value.provider}/\`${value.model}\`; single-harness qualification only.\n\n| Task | Exact success | Mean logical tokens/run |\n|---|---:|---:|\n${rows}\n\nAcross ${value.total_attempts} attempts, all ${value.total_successes} passed canonical independent verification. ${value.strong_effects_observed} strong fill/select/navigation effects and ${value.click_reactions_observed} click reactions were observed; ${value.done_actions} done actions carried no derived evidence. All ${value.provider_receipts} raw provider receipts reconcile one-to-one with ${value.planner_calls} planner calls. **Zero repair calls** were observed.\n\nClick evidence remained **shadow-only**. This report publishes no comparative token, cost, or latency claim. Generic click reaction cannot be enforced because deterministic tests retain both unrelated-mutation false attribution and no-DOM-effect cases.\n`;
}
function normalizeOpenAi(receipt, identity) {
  if (receipt.provider !== 'openai' || receipt.model !== 'gpt-4.1-mini') throw new Error(`${identity} provider/model mismatch`);
  const usage = receipt.usage;
  const inclusive = integer(usage.input_tokens, 'input_tokens');
  const read = integer(usage.input_tokens_details?.cached_tokens ?? 0, 'cached_tokens');
  const write = integer(usage.input_tokens_details?.cache_write_tokens ?? 0, 'cache_write_tokens');
  if (inclusive < read + write) throw new Error(`${identity} cache buckets exceed input`);
  return { input_tokens: inclusive - read - write, cache_read_tokens: read, cache_write_tokens: write, output_tokens: integer(usage.output_tokens, 'output_tokens') };
}
function pickUsage(value) { return { input_tokens: value.input_tokens, cache_read_tokens: value.cache_read_tokens, cache_write_tokens: value.cache_write_tokens, output_tokens: value.output_tokens }; }
function zeroUsage() { return { input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0 }; }
function addUsage(left, right) { return { input_tokens: left.input_tokens + right.input_tokens, cache_read_tokens: left.cache_read_tokens + right.cache_read_tokens, cache_write_tokens: left.cache_write_tokens + right.cache_write_tokens, output_tokens: left.output_tokens + right.output_tokens }; }
function integer(value, field) { if (!Number.isInteger(value) || value < 0) throw new Error(`invalid ${field}`); return value; }
function assertIdentities(label, actual, expected) { const values = new Set(actual); if (values.size !== actual.length || values.size !== expected.size || [...expected].some((id) => !values.has(id))) throw new Error(`${label} identity mismatch`); }
async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }
