import { exec as execCallback } from 'node:child_process';
import { appendFile, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { SettledBrowserPageSession } from '../../../../packages/action/src/index.ts';
import {
  BrowserActionGuardError,
  runBrowserAgent,
  TaggedLlmBrowserPlanner,
  type BrowserAgentRunRecorder,
  type BrowserAgentStep,
} from '../../../../packages/agent/src/index.ts';
import { LaunchingCdpBrowserBackend } from '../../../../packages/browser/src/index.ts';
import { parseCurveProtocol, planCurveResume, renderRoteCurveRun } from '../../../../packages/bench/src/index.ts';
import { createTaggedLlmClientFromEnv, type LlmProvider } from '../../../../packages/llm/src/index.ts';

const exec = promisify(execCallback);
const ROOT = new URL('../../../../', import.meta.url);
const PROTOCOL_PATH = new URL('../protocol.json', import.meta.url);
const WORDPRESS_ENV_PATH = new URL('../wordpress/.env', import.meta.url);

interface Args {
  out: string;
  checkpoints: string[];
  repetitions?: number;
  repetition?: number;
  probeModel?: string;
  resume: boolean;
  maxNewRuns?: number;
}

function parseArgs(argv: string[]): Args {
  const result: Args = { out: '', checkpoints: [], resume: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--resume') {
      result.resume = true;
      continue;
    }
    const value = argv[index + 1];
    if (flag === '--out' && value) result.out = value;
    else if (flag === '--checkpoint' && value) result.checkpoints.push(value);
    else if (flag === '--repetitions' && value && Number.isInteger(Number(value)) && Number(value) > 0) result.repetitions = Number(value);
    else if (flag === '--repetition' && value && Number.isInteger(Number(value)) && Number(value) > 0) result.repetition = Number(value);
    else if (flag === '--openai-probe-model' && value) result.probeModel = value;
    else if (flag === '--max-new-runs' && value && Number.isInteger(Number(value)) && Number(value) > 0) result.maxNewRuns = Number(value);
    else throw new Error(`unknown or invalid option: ${String(flag)}`);
    index += 1;
  }
  if (!result.out) throw new Error('--out <records.jsonl> is required');
  if (result.repetition !== undefined && result.repetitions !== undefined) throw new Error('--repetition and --repetitions are mutually exclusive');
  if (result.probeModel && (result.checkpoints.length !== 1 || result.repetitions !== 1)) {
    throw new Error('--openai-probe-model requires exactly one --checkpoint and --repetitions 1');
  }
  return result;
}

function readEnv(text: string): Record<string, string> {
  return Object.fromEntries(text.split('\n').filter((line) => line && !line.startsWith('#')).map((line) => {
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error('malformed WordPress environment file');
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function bindPrompt(template: string, env: Record<string, string>): string {
  const bindings = {
    wp_admin_user: env['ROTE_CURVE_WP_ADMIN_USER'],
    wp_admin_password: env['ROTE_CURVE_WP_ADMIN_PASSWORD'],
  };
  if (!bindings.wp_admin_user || !bindings.wp_admin_password) throw new Error('WordPress credentials are missing');
  let prompt = template;
  for (const [name, value] of Object.entries(bindings)) prompt = prompt.replaceAll(`{{${name}}}`, value);
  if (prompt.includes('{{')) throw new Error('curve prompt contains an unbound placeholder');
  return prompt;
}

async function runCommand(command: string): Promise<boolean> {
  try {
    await exec(command, { cwd: ROOT });
    return true;
  } catch {
    return false;
  }
}

async function existingRecords(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

class CurveRunCollector implements BrowserAgentRunRecorder {
  readonly steps: BrowserAgentStep[] = [];

  async recordStep(step: BrowserAgentStep): Promise<void> {
    this.steps.push(step);
  }

  async finish(): Promise<void> {}
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const frozen = parseCurveProtocol(JSON.parse(await readFile(PROTOCOL_PATH, 'utf8')));
  const protocol = args.probeModel ? {
    ...frozen,
    protocol_id: `${frozen.protocol_id}-openai-instrument-probe`,
    provider: 'openai',
    model: args.probeModel,
    repetitions_per_harness: 1,
  } : frozen;
  const provider = protocol.provider as LlmProvider;
  if (provider !== 'anthropic' && provider !== 'openai') throw new Error(`unsupported provider: ${provider}`);
  const checkpoints = protocol.checkpoints.filter((checkpoint) => (
    args.checkpoints.length === 0 || args.checkpoints.includes(checkpoint.id)
  ));
  if (checkpoints.length === 0) throw new Error('no protocol checkpoints selected');
  const wordpressEnv = readEnv(await readFile(WORDPRESS_ENV_PATH, 'utf8'));
  const repetitions = args.repetition === undefined
    ? Array.from({ length: args.repetitions ?? protocol.repetitions_per_harness }, (_, index) => index + 1)
    : [args.repetition];
  await mkdir(dirname(resolve(args.out)), { recursive: true });
  const resumePlan = planCurveResume(await existingRecords(args.out), args.resume, args.out);
  const completed = resumePlan.completedRunIds;
  if (resumePlan.initializeEmptyFile) await writeFile(args.out, '');

  let newRuns = 0;
  for (const checkpoint of checkpoints) {
    for (const repetition of repetitions) {
      const runId = `rote-${checkpoint.id}-r${String(repetition).padStart(2, '0')}`;
      if (completed.has(runId)) continue;
      console.log(`${checkpoint.id} repetition ${repetition}: starting`);
      if (!await runCommand(protocol.page.reset_command)) throw new Error(`reset failed for ${checkpoint.id} repetition ${repetition}`);
      const backend = new LaunchingCdpBrowserBackend({ windowSize: protocol.page.viewport });
      try {
        const rawPage = await backend.openPage();
        // WordPress keeps up to 15 background requests open in its editor. The default
        // remains zero everywhere else; this declared floor still requires a
        // mutation-quiet window before the next planner observation.
        const page = new SettledBrowserPageSession(rawPage, { maxPendingRequests: 15 });
        await page.navigate(protocol.page.initial_url);
        const collector = new CurveRunCollector();
        let success = false;
        let failureReason: string | undefined;
        try {
          const result = await runBrowserAgent({
            task: bindPrompt(checkpoint.prompt_template, wordpressEnv),
            page,
            planner: new TaggedLlmBrowserPlanner(createTaggedLlmClientFromEnv({ provider, model: protocol.model })),
            beforeAction({ action, nodes, resolvedSelector }) {
              if (checkpoint.operation_mode !== 'single_bulk' || action.kind !== 'click' || !['#doaction', '#doaction2'].includes(resolvedSelector ?? '')) return;
              const selected = new Set(nodes.filter((node) => node.state?.checked).map((node) => node.name));
              const expected = checkpoint.post_titles.map((title) => `Select ${title}`);
              const missing = expected.filter((name) => !selected.has(name));
              const extra = [...selected].filter((name) => !expected.includes(name));
              if (missing.length > 0 || extra.length > 0) {
                throw new BrowserActionGuardError(
                  `bulk apply requires the exact requested checkbox set; missing=${JSON.stringify(missing)}, extra=${JSON.stringify(extra)}`,
                  'checkbox',
                  missing[0],
                );
              }
            },
            verifier: {
              async verify() {
                const expectedItems = checkpoint.operation_mode === 'create_tag_each'
                  ? checkpoint.tag_names
                  : checkpoint.post_titles;
                const command = protocol.page.verify_command_template
                  .replace('{{expected_post_titles_json}}', shellQuote(JSON.stringify(expectedItems)))
                  .replace('{{expected_tag_names_json}}', shellQuote(JSON.stringify(expectedItems)));
                const passed = await runCommand(command);
                return { success: passed, summary: passed ? 'database verification passed' : 'database verification failed' };
              },
            },
            recorder: collector,
            maxSteps: checkpoint.target_steps + 10,
          });
          success = result.success;
          if (!success) failureReason = result.summary;
        } catch (error) {
          failureReason = error instanceof Error ? error.message : String(error);
        }
        const jsonl = renderRoteCurveRun({
          protocolId: protocol.protocol_id,
          taskId: checkpoint.id,
          provider,
          model: protocol.model,
          runId,
          repetition,
          targetSteps: checkpoint.target_steps,
          outcome: success ? 'success' : 'failure',
          steps: collector.steps,
        });
        await appendFile(args.out, jsonl, 'utf8');
        const file = await open(args.out, 'r');
        await file.sync();
        await file.close();
        console.log(`${checkpoint.id} repetition ${repetition}: ${collector.steps.length} agent steps, ${success ? 'success' : `failure (${failureReason})`}`);
        newRuns += 1;
        if (args.maxNewRuns !== undefined && newRuns >= args.maxNewRuns) return;
      } finally {
        await backend.close();
      }
    }
  }
}

await main();
