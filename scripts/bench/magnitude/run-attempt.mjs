import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { clearInterval, setInterval } from 'node:timers';
import { BrowserAgent } from 'magnitude-core';

const [attemptText, checkpointArg] = process.argv.slice(2);
const attempt = Number(attemptText);
if (!Number.isInteger(attempt) || attempt < 1 || !checkpointArg) throw new Error('run-attempt.mjs <attempt> <checkpoint>');
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required');
const protocol = JSON.parse(await readFile(new URL('./protocol.json', import.meta.url), 'utf8'));
const checkpointPath = resolve(checkpointArg);
const state = {
  schema_version: 1,
  attempt,
  started_at: new Date().toISOString(),
  ended_at: null,
  harness_started: false,
  harness_success: false,
  timed_out: false,
  usage_events: [],
  actions: [],
  body_text: '',
  final_url: null,
  error: null,
};
let agent;
let writing = Promise.resolve();
let sampling;
let stopping = false;

function persist() {
  writing = writing.then(async () => {
    const temporary = `${checkpointPath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
    await rename(temporary, checkpointPath);
  });
  return writing;
}

async function samplePage() {
  if (!agent || !state.harness_started) return;
  state.body_text = await agent.page.locator('body').innerText().catch(() => state.body_text);
  state.final_url = agent.page.url();
  await persist();
}

async function stop(exitCode) {
  if (stopping) return;
  stopping = true;
  clearInterval(sampling);
  await samplePage().catch(() => {});
  state.ended_at ??= new Date().toISOString();
  await persist().catch(() => {});
  if (agent) await agent.stop().catch(() => {});
  process.exit(exitCode);
}

process.once('SIGTERM', () => {
  state.timed_out = true;
  state.error = 'attempt exceeded frozen timeout';
  void stop(124);
});
process.once('SIGINT', () => {
  state.error = 'attempt interrupted';
  void stop(130);
});

try {
  agent = new BrowserAgent({
    agentOptions: {
      llm: { provider: 'openai', options: { model: protocol.model, apiKey: process.env.OPENAI_API_KEY, temperature: 0 } },
      telemetry: false,
    },
    browserOptions: {
      browser: {
        launchOptions: {
          executablePath: process.env.CHROME_PATH ?? '/snap/bin/chromium',
          headless: true,
        },
        contextOptions: { viewport: protocol.viewport },
      },
      virtualScreenDimensions: protocol.viewport,
      minScreenshots: 1,
    },
  });
  agent.events.on('tokensUsed', (usage) => {
    state.usage_events.push(JSON.parse(JSON.stringify(usage)));
    void persist();
  });
  agent.events.on('actionDone', (action) => {
    state.actions.push(JSON.parse(JSON.stringify(action)));
    void samplePage();
  });
  agent.events.on('actDone', () => {
    state.harness_success = true;
    void persist();
  });
  await agent.start();
  state.harness_started = true;
  await agent.nav(protocol.initial_url);
  await samplePage();
  sampling = setInterval(() => { void samplePage(); }, 1000);
  await agent.act(protocol.task_prompt);
  state.harness_success = true;
  await samplePage();
} catch (error) {
  state.error = error instanceof Error ? error.message : String(error);
} finally {
  state.ended_at = new Date().toISOString();
  await stop(state.error ? 1 : 0);
}
