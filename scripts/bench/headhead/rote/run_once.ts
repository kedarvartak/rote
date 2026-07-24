import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { RunManifestSchema } from '../../../../packages/core/src/index.ts';
import { CompetitorRawRunSchema } from '../../../../packages/bench/src/index.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const TASKS_PATH = resolve(ROOT, 'scripts/bench/headhead/tasks.json');

const TasksSchema = z.object({
  provider: z.literal('openai'),
  model: z.string().min(1),
  fixture_port: z.number().int().positive(),
  viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  tasks: z.array(z.object({
    id: z.string().min(1), name: z.string().min(1), path: z.string().min(1),
    prompt: z.string().min(1), verify_text: z.string().min(1),
  })),
});

interface Args { out: string; task: string; repetition: number; resume: boolean }

function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>(); let resume = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--resume') { resume = true; continue; }
    const flag = argv[index]; const value = argv[index + 1];
    if (!flag || !value || !['--out', '--task', '--repetition'].includes(flag)) throw new Error(usage());
    values.set(flag, value); index += 1;
  }
  const out = values.get('--out'); const task = values.get('--task'); const repetition = Number(values.get('--repetition'));
  if (!out || !task || !Number.isInteger(repetition) || repetition < 1) throw new Error(usage());
  return { out, task, repetition, resume };
}

/** Runs or resumes one atomic Rote G2 attempt and durably appends its neutral raw row. */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = TasksSchema.parse(JSON.parse(await readFile(TASKS_PATH, 'utf8')));
  const task = config.tasks.find((candidate) => candidate.id === args.task);
  if (!task) throw new Error(`unknown G2 task: ${args.task}`);
  const out = resolve(args.out); const rawPath = join(out, 'raw-runs.json');
  await mkdir(out, { recursive: true });
  const existing = await readRows(rawPath);
  const duplicate = existing.find((row) => row.task === task.id && row.repetition === args.repetition);
  if (duplicate) {
    if (!args.resume) throw new Error(`${task.id} repetition ${args.repetition} already exists; pass --resume`);
    console.log(`${task.id} repetition ${args.repetition}: already complete (${duplicate.outcome})`);
    return;
  }
  const runId = `g2-rote-${task.id.toLowerCase()}-r${String(args.repetition).padStart(2, '0')}`;
  const baseDir = join(out, '.rote');
  const runDir = join(baseDir, 'runs', runId);
  const manifestPath = join(runDir, 'manifest.json');
  let manifest = await readManifestIfPresent(manifestPath);
  if (!manifest && await exists(runDir)) {
    throw new Error(`${runId} has an incomplete artifact tail; refusing to overwrite append-only evidence`);
  }
  const commandArgs = [
    'packages/cli/bin/rote.js', 'run', task.prompt,
    '--url', `http://127.0.0.1:${config.fixture_port}/${task.path}`,
    '--verify-text', task.verify_text,
    '--model', config.model,
    '--viewport-width', String(config.viewport.width),
    '--viewport-height', String(config.viewport.height),
  ];
  if (!manifest) {
    const result = await run('node', commandArgs, { ...process.env, ROTE_RUN_ID: runId, ROTE_BASE_DIR: baseDir });
    try {
      manifest = RunManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
    } catch (error) {
      throw new Error(`Rote G2 attempt exited ${result.code} without an auditable manifest: ${message(error)}${result.stderr ? `; ${result.stderr}` : ''}`);
    }
  }
  const buckets = manifest.token_usage.reduce((total, usage) => ({
    input_tokens: total.input_tokens + usage.input_tokens,
    cache_read_tokens: total.cache_read_tokens + usage.cache_read_tokens,
    cache_write_tokens: total.cache_write_tokens + usage.cache_write_tokens,
    output_tokens: total.output_tokens + usage.output_tokens,
  }), { input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0 });
  const row = CompetitorRawRunSchema.parse({
    task: task.id,
    outcome: manifest.outcome,
    ...buckets,
    duration_ms: Math.max(0, Date.parse(manifest.ended_at) - Date.parse(manifest.started_at)),
    repetition: args.repetition,
    phase: 'cold',
  });
  const temporary = `${rawPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify([...existing, row], null, 2)}\n`, 'utf8');
  await rename(temporary, rawPath);
  const logical = row.input_tokens + row.cache_read_tokens + row.cache_write_tokens;
  console.log(`${task.id} repetition ${args.repetition}: ${row.outcome} logical=${logical} output=${row.output_tokens}`);
}

async function readManifestIfPresent(path: string): Promise<z.infer<typeof RunManifestSchema> | undefined> {
  try {
    return RunManifestSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function readRows(path: string): Promise<z.infer<typeof CompetitorRawRunSchema>[]> {
  try {
    return z.array(CompetitorRawRunSchema).parse(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: ROOT, env, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = ''; child.stderr.setEncoding('utf8'); child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject); child.on('exit', (code) => resolveRun({ code, stderr: stderr.trim() }));
  });
}

function usage(): string { return 'run_once.ts --out <dir> --task <B1|B2|B3> --repetition <n> [--resume]'; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

await main();
