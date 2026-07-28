import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { appendFile, cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Stagehand } from '@browserbasehq/stagehand';

const protocol = JSON.parse(await readFile(new URL('./protocol.json', import.meta.url), 'utf8'));
const PROTOCOL_ID = protocol.protocol_id;
const STAGEHAND_VERSION = protocol.harness_version;
const STAGEHAND_INTEGRITY = protocol.package_integrity;
const MODEL = protocol.model;
const TASK = protocol.task_prompt;
const VERIFY_TEXT = protocol.verify_text;
const MUTATIONS = protocol.mutations;

const outPath = resolve(process.argv[2] ?? 'bench-out/stagehand-qualification/receipts.jsonl');
const repetitions = Number(process.argv[3] ?? '3');
if (!Number.isInteger(repetitions) || repetitions < 1) throw new Error('repetitions must be a positive integer');
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required');
await mkdir(dirname(outPath), { recursive: true });
const existing = await readReceipts(outPath);
const identities = new Set(existing.map(identity));
if (existing.length === 0) await appendFile(outPath, '');

let activeMutation = null;
const template = await readFile(resolve('fixtures/sites/b2-vendor-drift.html'), 'utf8');
const server = createServer((_request, response) => {
  const html = template.replace(
    "const mutation = new URLSearchParams(location.search).get('mutation');",
    `const mutation = ${JSON.stringify(activeMutation)};`,
  );
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(html);
});
await new Promise((resolvePromise, reject) => {
  server.once('error', reject);
  server.listen(8091, '127.0.0.1', resolvePromise);
});
const url = protocol.initial_url;

try {
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    const repetitionDir = resolve(dirname(outPath), `r${String(repetition).padStart(2, '0')}`);
    const cacheDir = join(repetitionDir, 'cache');
    const snapshotDir = join(repetitionDir, 'cold-cache-snapshot');
    await mkdir(repetitionDir, { recursive: true });

    if (!identities.has(`cold:canonical:${repetition}`)) {
      await rm(cacheDir, { recursive: true, force: true });
      await mkdir(cacheDir, { recursive: true });
      activeMutation = null;
      const receipt = await executeCell({ phase: 'cold', mutation: 'canonical', repetition, cacheDir, url });
      await appendReceipt(outPath, receipt);
      identities.add(identity(receipt));
      if (receipt.exact_live_verification) {
        await rm(snapshotDir, { recursive: true, force: true });
        await cp(cacheDir, snapshotDir, { recursive: true });
      }
    }
    if (!(await exists(snapshotDir))) {
      console.log(`cold:canonical:${repetition} retained failed preparation; paired cells skipped`);
      continue;
    }

    const cells = [{ phase: 'warm', mutation: 'canonical' }, ...MUTATIONS.map((mutation) => ({ phase: 'drift', mutation }))];
    for (const cell of cells) {
      const key = `${cell.phase}:${cell.mutation}:${repetition}`;
      if (identities.has(key)) continue;
      await rm(cacheDir, { recursive: true, force: true });
      await cp(snapshotDir, cacheDir, { recursive: true });
      activeMutation = cell.mutation === 'canonical' ? null : cell.mutation;
      const receipt = await executeCell({ ...cell, repetition, cacheDir, url });
      await appendReceipt(outPath, receipt);
      identities.add(identity(receipt));
    }
  }
} finally {
  await new Promise((resolvePromise) => server.close(resolvePromise));
}

async function executeCell({ phase, mutation, repetition, cacheDir, url }) {
  const logs = [];
  const cacheBefore = await digestDirectory(cacheDir);
  const stagehand = new Stagehand({
    env: 'LOCAL',
    model: { modelName: MODEL, apiKey: process.env.OPENAI_API_KEY },
    localBrowserLaunchOptions: {
      headless: true,
      viewport: protocol.viewport,
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    },
    cacheDir,
    selfHeal: true,
    disablePino: true,
    verbose: 2,
    logger: (line) => logs.push(line),
  });
  let result;
  let page;
  let error;
  let durationMs = 0;
  try {
    await stagehand.init();
    page = stagehand.context.pages()[0];
    await page.goto(url, { waitUntil: 'load' });
    const agent = stagehand.agent({ model: MODEL, mode: 'dom' });
    const started = performance.now();
    result = await agent.execute({ instruction: TASK, maxSteps: 20 });
    durationMs = performance.now() - started;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  const bodyText = page ? await page.locator('body').innerText().catch(() => '') : '';
  const exactLiveVerification = bodyText.includes(VERIFY_TEXT);
  const metrics = await stagehand.metrics.catch(() => zeroMetrics());
  await stagehand.close().catch(() => {});
  const cacheAfter = await digestDirectory(cacheDir);
  const rawProviderReceipts = extractLoggedReceipts(logs);
  const rawUsage = sumLoggedUsage(rawProviderReceipts);
  const providerReceiptsComplete = rawUsage.input_tokens + rawUsage.cache_read_tokens === metrics.totalPromptTokens
    && rawUsage.cache_read_tokens === metrics.totalCachedInputTokens
    && rawUsage.output_tokens === metrics.totalCompletionTokens;
  const messages = logs.map((line) => line.message);
  const cacheHit = result?.metadata?.cacheHit === true || messages.includes('agent cache hit');
  const cacheUpdated = messages.includes('agent cache entry updated after self-heal');
  const replayFailed = messages.includes('agent cache replay failed');
  const usage = {
    input_tokens: Math.max(0, metrics.totalPromptTokens - metrics.totalCachedInputTokens),
    cache_read_tokens: metrics.totalCachedInputTokens,
    cache_write_tokens: 0,
    output_tokens: metrics.totalCompletionTokens,
  };
  const outcome = classify({ phase, exactLiveVerification, cacheHit, cacheUpdated, replayFailed, usage, error });
  const receipt = {
    schema_version: 1,
    protocol_id: PROTOCOL_ID,
    harness: 'stagehand',
    harness_version: STAGEHAND_VERSION,
    package_integrity: STAGEHAND_INTEGRITY,
    provider: 'openai',
    model: MODEL,
    viewport: protocol.viewport,
    task: protocol.task_id,
    phase,
    mutation,
    repetition,
    initial_url: url,
    verify_text: VERIFY_TEXT,
    harness_success: result?.success === true && result?.completed === true,
    exact_live_verification: exactLiveVerification,
    outcome,
    cache_hit: cacheHit,
    cache_updated: cacheUpdated,
    replay_failed: replayFailed,
    cache_identity_before: cacheBefore,
    cache_identity_after: cacheAfter,
    usage,
    stagehand_metrics: metrics,
    stagehand_result_usage: result?.usage ?? null,
    raw_provider_receipts: rawProviderReceipts,
    provider_receipts_complete: providerReceiptsComplete,
    duration_ms: durationMs,
    action_count: result?.actions?.length ?? 0,
    conclusion: result?.message ?? null,
    observed_body_text: bodyText,
    stagehand_actions: result?.actions ?? [],
    error: error ?? null,
    cache_logs: logs.filter((line) => line.category === 'cache'),
  };
  console.log(`${identity(receipt)} ${outcome} exact=${exactLiveVerification} cache=${cacheHit} tokens=${Object.values(usage).reduce((sum, value) => sum + value, 0)} receipts=${providerReceiptsComplete}`);
  return receipt;
}

function classify({ phase, exactLiveVerification, cacheHit, cacheUpdated, replayFailed, usage, error }) {
  if (error) return 'failure';
  if (!exactLiveVerification) return cacheHit ? 'silent_failure' : 'verification_failure';
  if (phase === 'cold') return 'cold_success';
  if (replayFailed) return 'full_fallback_success';
  if (cacheHit && cacheUpdated) return 'repaired_success';
  if (cacheHit && Object.values(usage).every((value) => value === 0)) return 'cached_success';
  if (cacheHit) return 'model_assisted_cache_success';
  return 'cold_miss_success';
}

function extractLoggedReceipts(logs) {
  return logs.flatMap((line) => {
    if (line.category !== 'aisdk' || line.message !== 'response') return [];
    const value = line.auxiliary?.response?.value;
    if (typeof value !== 'string') return [];
    try {
      const parsed = JSON.parse(value);
      return parsed.usage ? [{ usage: parsed.usage, finish_reason: parsed.finishReason ?? null }] : [];
    } catch {
      return [];
    }
  });
}

function sumLoggedUsage(receipts) {
  return receipts.reduce((sum, receipt) => ({
    input_tokens: sum.input_tokens + Number(receipt.usage.inputTokens ?? 0) - Number(receipt.usage.cachedInputTokens ?? 0),
    cache_read_tokens: sum.cache_read_tokens + Number(receipt.usage.cachedInputTokens ?? 0),
    output_tokens: sum.output_tokens + Number(receipt.usage.outputTokens ?? 0),
  }), { input_tokens: 0, cache_read_tokens: 0, output_tokens: 0 });
}

async function digestDirectory(directory) {
  const hash = createHash('sha256');
  for (const path of await files(directory)) {
    hash.update(path.slice(directory.length));
    hash.update(await readFile(path));
  }
  return hash.digest('hex');
}

async function files(directory) {
  if (!(await exists(directory))) return [];
  const output = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await files(path));
    else if (entry.isFile()) output.push(path);
  }
  return output;
}

async function readReceipts(path) {
  try {
    return (await readFile(path, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function appendReceipt(path, receipt) {
  await appendFile(path, `${JSON.stringify(receipt)}\n`);
}

function identity(receipt) {
  return `${receipt.phase}:${receipt.mutation}:${receipt.repetition}`;
}

async function exists(path) {
  try { await stat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function zeroMetrics() {
  return {
    totalPromptTokens: 0, totalCachedInputTokens: 0, totalCompletionTokens: 0,
    totalReasoningTokens: 0, totalInferenceTimeMs: 0,
  };
}
