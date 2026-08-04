import { appendFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const protocol = JSON.parse(await readFile(new URL('./protocol.json', import.meta.url), 'utf8'));
const outPath = resolve(process.argv[2] ?? 'bench-out/magnitude-qualification/receipts.jsonl');
const outDir = dirname(outPath);
const pendingPath = resolve(outDir, 'pending.json');
const recoveryOnly = process.env.MAGNITUDE_TEST_ONLY_RECOVER === '1';
if (!recoveryOnly && !process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required');
if (!recoveryOnly) await verifyInstallation();
await verifyCanonicalTask();
await mkdir(outDir, { recursive: true });
if (!(await exists(outPath))) await appendFile(outPath, '');
let receipts = await readReceipts(outPath);
await recoverPending(receipts);
receipts = await readReceipts(outPath);
if (recoveryOnly) {
  console.log('Magnitude pending-attempt recovery test complete');
  process.exit(0);
}
const serverLog = await open(resolve(outDir, 'fixture-server.log'), 'a');
const server = spawn('node', ['scripts/bench/headhead/serve-fixtures.mjs', '8094'], {
  cwd: resolve('.'),
  stdio: ['ignore', serverLog.fd, serverLog.fd],
});
try {
  await waitForFixture();
  for (let attempt = 1; attempt <= protocol.attempt_cap; attempt += 1) {
    if (receipts.some((receipt) => receipt.attempt === attempt)) continue;
    if (exactSuccesses(receipts) >= protocol.required_exact_successes || hasSilentWrong(receipts)) break;
    const attemptDir = resolve(outDir, `attempt-${String(attempt).padStart(2, '0')}`);
    const checkpointPath = resolve(attemptDir, 'checkpoint.json');
    const logPath = resolve(attemptDir, 'magnitude.log');
    await mkdir(attemptDir, { recursive: true });
    await writeAtomic(pendingPath, {
      schema_version: 1,
      protocol_id: protocol.protocol_id,
      attempt,
      checkpoint_path: checkpointPath,
      started_at: new Date().toISOString(),
    });
    const result = await runChild(attempt, checkpointPath, logPath);
    const checkpoint = await readJsonIfPresent(checkpointPath);
    const receipt = buildReceipt(attempt, checkpoint, result);
    await appendFile(outPath, `${JSON.stringify(receipt)}\n`);
    await rm(pendingPath, { force: true });
    receipts.push(receipt);
    console.log(`cold:canonical:${attempt} ${receipt.outcome} harness=${receipt.harness_success} exact=${receipt.exact_live_verification} usage_events=${receipt.aggregate_usage_events?.length ?? 0} raw_receipts=0`);
    if (receipt.harness_success && !receipt.exact_live_verification) {
      console.log('stopping after harness-success/oracle-failure');
      break;
    }
  }
} finally {
  server.kill('SIGTERM');
  await serverLog.close();
}

async function runChild(attempt, checkpointPath, logPath) {
  const log = await open(logPath, 'a');
  const child = spawn('node', [resolve(scriptDir, 'run-attempt.mjs'), String(attempt), checkpointPath], {
    cwd: scriptDir,
    env: process.env,
    stdio: ['ignore', log.fd, log.fd],
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 5000).unref();
  }, protocol.attempt_timeout_ms);
  const code = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', resolveExit);
  });
  clearTimeout(timer);
  await log.close();
  return { code, timed_out: timedOut };
}

function buildReceipt(attempt, checkpoint, result, abandoned = false) {
  const usageEvents = Array.isArray(checkpoint?.usage_events) ? checkpoint.usage_events : null;
  const aggregateUsage = usageEvents && usageEvents.length > 0 ? normalizeAggregateUsage(usageEvents) : null;
  const bodyText = typeof checkpoint?.body_text === 'string' ? checkpoint.body_text : '';
  const exact = bodyText.includes(protocol.verify_text);
  const harnessSuccess = checkpoint?.harness_success === true;
  const outcome = abandoned
    ? 'abandoned'
    : harnessSuccess && !exact
      ? 'silent_failure'
      : harnessSuccess && exact
        ? 'exact_success'
        : result.timed_out || checkpoint?.timed_out
          ? 'timeout'
          : exact
            ? 'verification_only'
            : 'failure';
  return {
    schema_version: 1,
    protocol_id: protocol.protocol_id,
    harness: protocol.harness,
    harness_version: protocol.harness_version,
    package_integrity: protocol.package_integrity,
    package_shasum: protocol.package_shasum,
    npm_git_head: protocol.npm_git_head,
    provider: protocol.provider,
    model: protocol.model,
    viewport: protocol.viewport,
    task: protocol.task_id,
    phase: 'cold',
    mutation: 'canonical',
    attempt,
    initial_url: protocol.initial_url,
    verify_text: protocol.verify_text,
    harness_success: harnessSuccess,
    exact_live_verification: exact,
    outcome,
    aggregate_usage: aggregateUsage,
    aggregate_usage_events: usageEvents,
    raw_provider_receipts: [],
    provider_receipts_complete: false,
    duration_ms: duration(checkpoint),
    action_count: Array.isArray(checkpoint?.actions) ? checkpoint.actions.length : null,
    magnitude_actions: Array.isArray(checkpoint?.actions) ? checkpoint.actions : [],
    observed_body_text: bodyText,
    final_url: checkpoint?.final_url ?? null,
    error: checkpoint?.error ?? (result.code === 0 ? null : `attempt process exited ${String(result.code)}`),
    started_at: checkpoint?.started_at ?? null,
    ended_at: checkpoint?.ended_at ?? null,
  };
}

async function recoverPending(receipts) {
  const pending = await readJsonIfPresent(pendingPath);
  if (!pending || receipts.some((receipt) => receipt.attempt === pending.attempt)) {
    if (pending) await rm(pendingPath, { force: true });
    return;
  }
  const checkpoint = await readJsonIfPresent(pending.checkpoint_path);
  const receipt = buildReceipt(pending.attempt, checkpoint, { code: null, timed_out: false }, true);
  await appendFile(outPath, `${JSON.stringify(receipt)}\n`);
  await rm(pendingPath, { force: true });
  console.log(`recovered interrupted cold:canonical:${pending.attempt} as abandoned without rerunning it`);
}

function normalizeAggregateUsage(events) {
  return events.reduce((total, event) => {
    const input = integer(event.inputTokens, 'inputTokens');
    const read = integer(event.cacheReadInputTokens ?? 0, 'cacheReadInputTokens');
    const write = integer(event.cacheWriteInputTokens ?? 0, 'cacheWriteInputTokens');
    const output = integer(event.outputTokens, 'outputTokens');
    return {
      input_tokens: total.input_tokens + Math.max(0, input - read - write),
      cache_read_tokens: total.cache_read_tokens + read,
      cache_write_tokens: total.cache_write_tokens + write,
      output_tokens: total.output_tokens + output,
    };
  }, { input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0 });
}

async function verifyInstallation() {
  const installed = JSON.parse(await readFile(resolve(scriptDir, 'node_modules/magnitude-core/package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(resolve(scriptDir, 'package-lock.json'), 'utf8'));
  const locked = lock.packages?.['node_modules/magnitude-core'];
  if (installed.version !== protocol.harness_version || installed.license !== protocol.license) throw new Error('installed Magnitude version/license mismatch');
  if (locked?.version !== protocol.harness_version || locked?.integrity !== protocol.package_integrity) throw new Error('Magnitude lockfile version/integrity mismatch');
}

async function verifyCanonicalTask() {
  const tasks = JSON.parse(await readFile(resolve('scripts/bench/headhead/tasks.json'), 'utf8'));
  const task = tasks.tasks.find((candidate) => candidate.id === protocol.task_id);
  if (!task || task.prompt !== protocol.task_prompt || task.verify_text !== protocol.verify_text) throw new Error('Magnitude protocol differs from canonical B2');
  if (tasks.provider !== protocol.provider || tasks.model !== protocol.model || JSON.stringify(tasks.viewport) !== JSON.stringify(protocol.viewport)) throw new Error('Magnitude provider/model/viewport mismatch');
}

async function waitForFixture() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      if ((await globalThis.fetch(protocol.initial_url)).ok) return;
    } catch {
      // The server starts in a child process; connection refusal is expected while polling.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('Magnitude fixture server did not become ready');
}

async function readReceipts(path) { return (await readFile(path, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line)); }
async function readJsonIfPresent(path) { try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function writeAtomic(path, value) { const temporary = `${path}.tmp`; await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`); await rename(temporary, path); }
async function exists(path) { try { await stat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
function exactSuccesses(receipts) { return receipts.filter((receipt) => receipt.harness_success && receipt.exact_live_verification).length; }
function hasSilentWrong(receipts) { return receipts.some((receipt) => receipt.harness_success && !receipt.exact_live_verification); }
function integer(value, field) { if (!Number.isInteger(value) || value < 0) throw new Error(`invalid Magnitude ${field}`); return value; }
function duration(checkpoint) { const start = Date.parse(checkpoint?.started_at ?? ''); const end = Date.parse(checkpoint?.ended_at ?? ''); return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null; }
