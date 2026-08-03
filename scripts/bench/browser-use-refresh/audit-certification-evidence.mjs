import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const evidence = resolve(process.argv[2] ?? 'bench-out/browser-use-0137-certification/evidence');
const output = resolve(process.argv[3] ?? `${evidence}/receipt-audit.json`);
const [manifests, trajectoryText, browserDumps] = await Promise.all([
  readJson(`${evidence}/rote-manifests.json`),
  readFile(`${evidence}/rote-trajectories.jsonl`, 'utf8'),
  readJson(`${evidence}/browser-use-dumps.json`),
]);
const events = trajectoryText.split('\n').filter(Boolean).map((line) => JSON.parse(line));
const eventsByRun = new Map();
for (const event of events) eventsByRun.set(event.run_id, [...(eventsByRun.get(event.run_id) ?? []), event]);
let roteProviderReceipts = 0;
for (const manifest of manifests) {
  const runEvents = eventsByRun.get(manifest.run_id) ?? [];
  if (runEvents.length === 0) throw new Error(`${manifest.run_id} has no trajectory events`);
  const bySource = new Map();
  for (const event of runEvents) {
    const value = event.result_ref?.kind === 'inline' ? event.result_ref.value : undefined;
    if (!value?.planner_usage || !Array.isArray(value.provider_receipts) || value.provider_receipts.length === 0) {
      throw new Error(`${manifest.run_id}/${event.seq} has no inline planner usage/provider receipts`);
    }
    const receiptTotal = value.provider_receipts.reduce((sum, receipt) => {
      if (receipt.provider !== 'openai' || receipt.model !== 'gpt-4.1-mini') {
        throw new Error(`${manifest.run_id}/${event.seq} provider/model mismatch`);
      }
      roteProviderReceipts += 1;
      const usage = receipt.usage;
      const inclusiveInput = integer(usage.input_tokens, 'input_tokens');
      const read = integer(usage.input_tokens_details?.cached_tokens ?? 0, 'cached_tokens');
      const write = integer(usage.input_tokens_details?.cache_write_tokens ?? 0, 'cache_write_tokens');
      const outputTokens = integer(usage.output_tokens, 'output_tokens');
      if (inclusiveInput < read + write) throw new Error(`${manifest.run_id}/${event.seq} cache buckets exceed input`);
      return add(sum, { input_tokens: inclusiveInput - read - write, cache_read_tokens: read, cache_write_tokens: write, output_tokens: outputTokens });
    }, zero());
    const planner = pickUsage(value.planner_usage);
    if (JSON.stringify(receiptTotal) !== JSON.stringify(planner)) {
      throw new Error(`${manifest.run_id}/${event.seq} planner usage does not reconcile to raw provider receipts`);
    }
    const source = value.planner_usage.source;
    bySource.set(source, add(bySource.get(source) ?? zero(), planner));
  }
  const manifestBySource = new Map();
  for (const usage of manifest.token_usage) {
    manifestBySource.set(usage.source, add(manifestBySource.get(usage.source) ?? zero(), pickUsage(usage)));
  }
  if (JSON.stringify([...bySource].sort()) !== JSON.stringify([...manifestBySource].sort())) {
    throw new Error(`${manifest.run_id} manifest usage does not reconcile to trajectory receipts`);
  }
}

let browserProviderReceipts = 0;
for (const dump of browserDumps) {
  if (dump.browser_use_version !== '0.13.7' || dump.model !== 'gpt-4.1-mini' || dump.provider !== 'openai') {
    throw new Error(`Browser Use B2/${dump.repetition} provenance mismatch`);
  }
  if (dump.outcome !== 'success' || dump.is_successful !== true || dump.verify_text_visible !== true) {
    throw new Error(`Browser Use B2/${dump.repetition} did not pass both success signals`);
  }
  const total = dump.provider_receipts.reduce((sum, receipt) => {
    browserProviderReceipts += 1;
    const usage = receipt.usage;
    const prompt = integer(usage.prompt_tokens, 'prompt_tokens');
    const read = integer(usage.prompt_cached_tokens ?? 0, 'prompt_cached_tokens');
    const genericWrite = integer(usage.prompt_cache_creation_tokens ?? 0, 'prompt_cache_creation_tokens');
    const fiveMinuteWrite = integer(usage.prompt_cache_creation_5m_tokens ?? 0, 'prompt_cache_creation_5m_tokens');
    if (integer(usage.prompt_cache_creation_1h_tokens ?? 0, 'prompt_cache_creation_1h_tokens') > 0 || (genericWrite > 0 && fiveMinuteWrite > 0)) {
      throw new Error(`Browser Use B2/${dump.repetition} has unsupported cache writes`);
    }
    const write = genericWrite || fiveMinuteWrite;
    if (prompt < read + write) throw new Error(`Browser Use B2/${dump.repetition} cache buckets exceed input`);
    return add(sum, { input_tokens: prompt - read - write, cache_read_tokens: read, cache_write_tokens: write, output_tokens: integer(usage.completion_tokens, 'completion_tokens') });
  }, zero());
  if (JSON.stringify(total) !== JSON.stringify(pickUsage(dump))) {
    throw new Error(`Browser Use B2/${dump.repetition} aggregate does not reconcile to raw provider receipts`);
  }
}

const audit = {
  protocol_id: 'p1-g2-fixtures-v3-b2-browser-use-0137-paired',
  rote_runs: manifests.length,
  rote_trajectory_events: events.length,
  rote_provider_receipts: roteProviderReceipts,
  browser_use_runs: browserDumps.length,
  browser_use_provider_receipts: browserProviderReceipts,
  all_usage_reconciled: true,
  all_successes_independently_verified: true,
};
await writeFile(output, `${JSON.stringify(audit, null, 2)}\n`);
console.log(`audited ${roteProviderReceipts + browserProviderReceipts} raw provider receipts across ${manifests.length + browserDumps.length} runs`);

async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }
function integer(value, label) { if (!Number.isInteger(value) || value < 0) throw new Error(`invalid ${label}`); return value; }
function zero() { return { input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0 }; }
function pickUsage(value) { return { input_tokens: value.input_tokens, cache_read_tokens: value.cache_read_tokens, cache_write_tokens: value.cache_write_tokens, output_tokens: value.output_tokens }; }
function add(left, right) { return { input_tokens: left.input_tokens + right.input_tokens, cache_read_tokens: left.cache_read_tokens + right.cache_read_tokens, cache_write_tokens: left.cache_write_tokens + right.cache_write_tokens, output_tokens: left.output_tokens + right.output_tokens }; }
