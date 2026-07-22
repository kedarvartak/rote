import { exec as execCallback } from 'node:child_process';
import { appendFile, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { SettledBrowserPageSession } from '../../../../packages/action/src/index.ts';
import { BrowserActionGuardError, runBrowserAgent, TaggedLlmBrowserPlanner } from '../../../../packages/agent/src/index.ts';
import { LaunchingCdpBrowserBackend } from '../../../../packages/browser/src/index.ts';
import { parseCurveProtocol, renderRoteCurveRun } from '../../../../packages/bench/src/index.ts';
import { createTaggedLlmClientFromEnv, type LlmProvider } from '../../../../packages/llm/src/index.ts';

const exec = promisify(execCallback);
const ROOT = new URL('../../../../', import.meta.url);
const PROTOCOL_PATH = new URL('../protocol.json', import.meta.url);
const WORDPRESS_ENV_PATH = new URL('../wordpress/.env', import.meta.url);

interface Args {
  out: string;
  checkpoints: string[];
  repetitions?: number;
  probeModel?: string;
}

function parseArgs(argv: string[]): Args {
  const result: Args = { out: '', checkpoints: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--out' && value) result.out = value;
    else if (flag === '--checkpoint' && value) result.checkpoints.push(value);
    else if (flag === '--repetitions' && value && Number.isInteger(Number(value)) && Number(value) > 0) result.repetitions = Number(value);
    else if (flag === '--openai-probe-model' && value) result.probeModel = value;
    else throw new Error(`unknown or invalid option: ${String(flag)}`);
    index += 1;
  }
  if (!result.out) throw new Error('--out <records.jsonl> is required');
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
  const repetitions = args.repetitions ?? protocol.repetitions_per_harness;
  await mkdir(dirname(resolve(args.out)), { recursive: true });
  await writeFile(args.out, '');

  for (const checkpoint of checkpoints) {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      if (!await runCommand(protocol.page.reset_command)) throw new Error(`reset failed for ${checkpoint.id} repetition ${repetition}`);
      const backend = new LaunchingCdpBrowserBackend({ windowSize: protocol.page.viewport });
      try {
        const rawPage = await backend.openPage();
        // WordPress keeps one background request open after login. The default
        // remains zero everywhere else; this declared floor still requires a
        // mutation-quiet window before the next planner observation.
        const page = new SettledBrowserPageSession(rawPage, { maxPendingRequests: 1 });
        await page.navigate(protocol.page.initial_url);
        const result = await runBrowserAgent({
          task: bindPrompt(checkpoint.prompt_template, wordpressEnv),
          page,
          planner: new TaggedLlmBrowserPlanner(createTaggedLlmClientFromEnv({ provider, model: protocol.model })),
          beforeAction({ action, nodes, resolvedSelector }) {
            if (action.kind !== 'click' || !['#doaction', '#doaction2'].includes(resolvedSelector ?? '')) return;
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
              const command = protocol.page.verify_command_template.replace(
                '{{expected_post_titles_json}}', shellQuote(JSON.stringify(checkpoint.post_titles)),
              );
              const passed = await runCommand(command);
              return { success: passed, summary: passed ? 'database verification passed' : 'database verification failed' };
            },
          },
          maxSteps: checkpoint.target_steps + 5,
        });
        const runId = `rote-${checkpoint.id}-r${String(repetition).padStart(2, '0')}`;
        const jsonl = renderRoteCurveRun({
          protocolId: protocol.protocol_id,
          taskId: checkpoint.id,
          provider,
          model: protocol.model,
          runId,
          repetition,
          targetSteps: checkpoint.target_steps,
          outcome: result.success ? 'success' : 'failure',
          steps: result.steps,
        });
        await appendFile(args.out, jsonl, 'utf8');
        const file = await open(args.out, 'r');
        await file.sync();
        await file.close();
        console.log(`${checkpoint.id} repetition ${repetition}: ${result.steps.length} agent steps, ${result.success ? 'success' : 'failure'}`);
      } finally {
        await backend.close();
      }
    }
  }
}

await main();
