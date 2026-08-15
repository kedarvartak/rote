/**
 * Structural action-contract drift demo (#143): the same recorded procedure,
 * replayed against six versions of one page in a real Chrome, zero model calls.
 *
 *   npx tsx scripts/demo/action-contract-drift-demo.ts            # narrated
 *   npx tsx scripts/demo/action-contract-drift-demo.ts --json     # machine-readable acts
 *
 * Act 0 records the value-free action contract of every element step from a
 * live capture of the frozen page. Acts 1–5 serve a variant at the *same URL*
 * and replay through the production executor (`runPlaybook` + `BrowserToolCaller`):
 *
 *   1  cosmetic redesign         → replays, contract equal
 *   2  ids renamed + remounted   → selectors repaired from identity, replays
 *   3  input became a textarea   → contract_mismatch, field untouched
 *   4  submit destination moved  → contract_mismatch, no click
 *   5  submit became a POST purge with a fake "complete" banner
 *        gate ON  → contract_mismatch, purge endpoint hits: 0
 *        gate OFF → the click lands, purge endpoint hits: 1, banner says complete
 *
 * The purge counter is the demo's external oracle: the UI banner is not what
 * decides success (docs/02-architecture.md "Structural action-contract drift").
 * Requires Chrome/Chromium (CHROME_PATH or a standard install path).
 */
import { createServer, type Server } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deriveActionContract } from '@rote/action';
import { findChromeExecutable, LaunchingCdpBrowserBackend, type BrowserContextCoordinate, type CdpPage } from '@rote/browser';
import { buildEnvFingerprint, PlaybookSchema, type ActionContract, type Playbook } from '@rote/core';
import { BrowserToolCaller, runPlaybook, type BrowserReplayPage, type ExecutorResult, type LlmClient } from '@rote/executor';
import { distillPage, stableNodeRef } from '@rote/perception';

const FIXTURES = resolve('fixtures/sites/contract-drift');
const REGISTER_PATH = '/vendors/register';
const json = process.argv.includes('--json');

interface Act {
  act: number;
  title: string;
  variant: string;
  gate: 'on' | 'off';
  outcome: string;
  failureCode?: string;
  reason?: string;
  repairedStepIds: string[];
  dispatched: { fills: number; clicks: number };
  purgeHits: number;
  llmCalls: number;
}

/** Serves whichever variant is current at the frozen URL, plus the two "elsewhere" destinations. */
class VariantServer {
  variant = 'v1-frozen.html';
  purgeHits = 0;
  private server?: Server;
  origin = '';
  async start(): Promise<void> {
    this.server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === REGISTER_PATH && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(await readFile(join(FIXTURES, this.variant), 'utf8'));
      } else if (url.pathname === '/vendors/register-v2') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><title>Vendor onboarding v2</title><main><h1>Vendor onboarding v2</h1><p>Nothing was registered here.</p></main>');
      } else if (url.pathname === '/vendors/delete-all' && req.method === 'POST') {
        this.purgeHits += 1;
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><title>Vendor Registration</title><main><section role="status">Vendor registration complete</section></main>');
      } else {
        res.writeHead(404); res.end();
      }
    });
    await new Promise<void>((done) => this.server!.listen(0, '127.0.0.1', () => done()));
    const address = this.server!.address();
    if (!address || typeof address === 'string') throw new Error('demo server did not bind');
    this.origin = `http://127.0.0.1:${address.port}`;
  }
  async close(): Promise<void> { await new Promise<void>((done) => this.server?.close(() => done())); }
}

/** Counts what actually reaches the browser: the gate throws before these are called. */
class CountingPage implements BrowserReplayPage {
  fills = 0; clicks = 0;
  constructor(private readonly page: CdpPage) {}
  navigate(url: string) { return this.page.navigate(url); }
  capture() { return this.page.capture(); }
  async fill(selector: string, value: string, context?: BrowserContextCoordinate) { this.fills += 1; await this.page.fill(selector, value, context); }
  select(selector: string, value: string, context?: BrowserContextCoordinate) { return this.page.select(selector, value, context); }
  async click(selector: string, context?: BrowserContextCoordinate) { this.clicks += 1; await this.page.click(selector, context); }
}

const noLlm: LlmClient = { async complete() { throw new Error('the contract gate never calls a model'); } };

function playbookFor(url: string, fill: { stableId: string; contract: ActionContract }, submit: { stableId: string; contract: ActionContract }, gate: 'on' | 'off'): Playbook {
  const contract = (value: ActionContract) => (gate === 'on' ? { contract: value } : {});
  return PlaybookSchema.parse({
    playbook: 'contract-drift-demo',
    version: 1,
    task_signature: { intent_description: 'Register a vendor company', env_fingerprint: { domain: '127.0.0.1', tool_prefixes: ['browser.'] } },
    params: [{ name: 'company_name', type: 'string' }],
    steps: [
      { id: 'open_registration', kind: 'deterministic', tool: 'browser.navigate', args: { url }, expect: { text_visible: 'Company name' }, on_fail: 'fallback' },
      { id: 'fill_company', kind: 'deterministic', depends_on: ['open_registration'], tool: 'browser.fill',
        args: { selector: '#company-name', stableId: fill.stableId, role: 'textbox', name: 'Company name', value: '{{company_name}}', ...contract(fill.contract) },
        expect: { input_value: '#company-name', equals: '{{company_name}}' }, on_fail: 'fallback' },
      { id: 'submit_registration', kind: 'deterministic', depends_on: ['fill_company'], tool: 'browser.click',
        args: { selector: '#registration-submit', stableId: submit.stableId, role: 'button', name: 'Submit registration', ...contract(submit.contract) },
        expect: { text_visible: 'Vendor registration complete' }, on_fail: 'fallback' },
    ],
    verify: [{ text_visible: 'Vendor registration complete' }],
    confidence: 1,
  });
}

function say(line = ''): void { if (!json) console.log(line); }

async function main(): Promise<void> {
  const chromePath = findChromeExecutable();
  if (!chromePath) { console.error('Chrome/Chromium not found: set CHROME_PATH'); process.exit(2); }
  const server = new VariantServer();
  await server.start();
  const backend = new LaunchingCdpBrowserBackend({ chromePath, windowSize: { width: 1280, height: 800 } });
  const baseDir = await mkdtemp(join(tmpdir(), 'rote-contract-drift-demo-'));
  const url = `${server.origin}${REGISTER_PATH}`;
  const acts: Act[] = [];
  try {
    // Act 0 — record: derive each step's contract from the live frozen page.
    const recorder = await backend.openPage();
    await recorder.navigate(url);
    const nodes = distillPage(await recorder.capture());
    recorder.close();
    const pick = (selector: string) => { const node = nodes.find((n) => n.selectorHint === selector); if (!node) throw new Error(`frozen page lacks ${selector}`); return node; };
    const fill = { stableId: stableNodeRef(pick('#company-name').id), contract: deriveActionContract({ verb: 'fill', node: pick('#company-name') }) };
    const submit = { stableId: stableNodeRef(pick('#registration-submit').id), contract: deriveActionContract({ verb: 'click', node: pick('#registration-submit') }) };
    say('=== Act 0: record the procedure against the frozen page (real Chrome, 0 model calls) ===');
    say(`fill   "Company name"        ${fill.stableId}  ${describe(fill.contract)}`);
    say(`click  "Submit registration" ${submit.stableId}  ${describe(submit.contract)}`);
    say('(contracts are value-free: what the control is, where it goes, how it acts — never what was typed)');
    say();

    const scenes: Array<{ act: number; title: string; variant: string; gate: 'on' | 'off' }> = [
      { act: 1, title: 'cosmetic redesign (new palette, classes, wrappers)', variant: 'v2-cosmetic.html', gate: 'on' },
      { act: 2, title: 'ids renamed + form remounted under new landmarks', variant: 'v3-selector-remount.html', gate: 'on' },
      { act: 3, title: 'same-named field is now a <textarea> (Enter inserts a newline)', variant: 'v4-textarea.html', gate: 'on' },
      { act: 4, title: 'same-named submit now goes to a different destination', variant: 'v5-destination.html', gate: 'on' },
      { act: 5, title: 'same-named submit is now a POST purge behind a fake "complete" banner — gate ON', variant: 'v6-destructive.html', gate: 'on' },
      { act: 5, title: 'the same purge page with the contract gate OFF (blind replay, for contrast)', variant: 'v6-destructive.html', gate: 'off' },
    ];
    for (const scene of scenes) {
      server.variant = scene.variant;
      const purgeBefore = server.purgeHits;
      const page = new CountingPage(await backend.openPage());
      let llmCalls = 0;
      const countingLlm: LlmClient = { async complete(...args) { llmCalls += 1; return noLlm.complete(...args); } };
      const result: ExecutorResult = await runPlaybook(playbookFor(url, fill, submit, scene.gate), { company_name: 'Acme Tools' }, {
        toolCaller: new BrowserToolCaller(page),
        llmClient: countingLlm,
        envFingerprint: buildEnvFingerprint({ tool_inventory: [{ name: 'browser.click', schema_hash: 'v1' }], target_identity: 'contract-drift.demo', surface_versions: {} }),
        taskSpec: 'Register Acme Tools',
        baseDir,
      });
      const act: Act = {
        act: scene.act, title: scene.title, variant: scene.variant, gate: scene.gate,
        outcome: result.outcome, ...(result.failureCode ? { failureCode: result.failureCode } : {}), ...(result.reason ? { reason: result.reason } : {}),
        repairedStepIds: result.repairedStepIds, dispatched: { fills: page.fills, clicks: page.clicks },
        purgeHits: server.purgeHits - purgeBefore, llmCalls,
      };
      acts.push(act);
      say(`=== Act ${act.act}: ${act.title} ===`);
      say(`outcome=${act.outcome}${act.failureCode ? ` failure=${act.failureCode}` : ''}  dispatched fills=${act.dispatched.fills} clicks=${act.dispatched.clicks}  purge endpoint hits=${act.purgeHits}  model calls=${act.llmCalls}`);
      if (act.repairedStepIds.length > 0) say(`repaired from identity: ${act.repairedStepIds.join(', ')}`);
      if (act.reason) say(`why: ${act.reason}`);
      say();
    }
    if (json) console.log(JSON.stringify({ url: REGISTER_PATH, contracts: { fill: fill.contract, submit: submit.contract }, acts }, null, 2));
    else {
      console.log('=== Summary ===');
      console.log('cosmetic + structural drift replays; contract drift dispatches nothing; the only run that "succeeded" on the purge page was the ungated one — and the oracle shows what it did.');
    }
    const gateOff = acts.find((act) => act.gate === 'off');
    const gatedPurge = acts.find((act) => act.act === 5 && act.gate === 'on');
    // Self-check so a broken demo is loud, not pretty.
    if (!(acts.filter((a) => a.act <= 2).every((a) => a.outcome === 'success') && acts.filter((a) => a.act >= 3 && a.gate === 'on').every((a) => a.failureCode === 'BROWSER_CONTRACT_MISMATCH' && a.dispatched.clicks === 0)
      && gatedPurge?.purgeHits === 0 && gateOff?.purgeHits === 1 && acts.every((a) => a.llmCalls === 0))) {
      console.error('demo self-check failed'); process.exitCode = 1;
    }
  } finally {
    await backend.close();
    await server.close();
    await rm(baseDir, { recursive: true, force: true });
  }
}

function describe(contract: ActionContract): string {
  const a = contract.affordance;
  return `${contract.verb} ${a.control}${a.enter_behavior ? ` enter=${a.enter_behavior}` : ''}${a.form_method ? ` method=${a.form_method}` : ''}${a.destination_hash ? ` dest=${a.destination_hash}` : ''} safety=${contract.safety}`;
}

await main();
