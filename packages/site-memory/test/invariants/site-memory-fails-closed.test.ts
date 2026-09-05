import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileBrowserAgentRunRecorder, runBrowserAgent, type BrowserAction, type BrowserPageSession, type BrowserPlannerClient } from '@rote/agent';
import { captureStaticHtml } from '@rote/browser';
import { buildEnvFingerprint, pageKey, SiteMemoryRecordSchema } from '@rote/core';
import { loadRecordedRun } from '@rote/distiller';
import { consolidateSiteMemory, deriveSiteMemory, FileSiteMemoryStore, MemorySiteMemoryStore, siteMemoryLogPath, SiteMemoryPartitionError } from '../../src/index.js';

// see docs/02-architecture.md "Tiers 1 and 2 — the learning plane" — sacred
// invariants for site memory: never cross environments (a partition holds and
// serves only its fingerprint's records), everything versioned (append-only file,
// no edit path, interrupted writes recover), and value-free (a run with typed
// values and secret query strings teaches identity, structure, and edges only).

const FORM_URL = 'https://fixture.test/vendors/register?session=topsecret';
const DONE_URL = 'https://fixture.test/vendors/complete';
const FORM_HTML = `<!doctype html><html><head><title>Vendor Registration</title></head><body>
<form id="registration-form" method="post" action="/vendors/complete">
  <label for="company-name">Company name</label><input id="company-name" name="company_name" />
  <label for="notes">Notes</label><textarea id="notes" name="notes"></textarea>
  <button id="registration-submit" type="submit">Submit registration</button>
</form></body></html>`;
const DONE_HTML = '<!doctype html><html><head><title>Done</title></head><body><main><h1>Vendor registration complete</h1></main></body></html>';

/** Two-page static site: the form submits to a confirmation page at another path. */
class TwoPageSite implements BrowserPageSession {
  private submitted = false;
  private readonly values = new Map<string, string>();
  async navigate(): Promise<void> {}
  async capture() {
    if (this.submitted) return captureStaticHtml(DONE_URL, DONE_HTML);
    const page = captureStaticHtml(FORM_URL, FORM_HTML);
    for (const element of page.elements) {
      const value = element.attributes['id'] ? this.values.get(`#${element.attributes['id']}`) : undefined;
      if (value !== undefined) element.attributes['value'] = value;
    }
    return page;
  }
  async fill(selector: string, value: string): Promise<void> { this.values.set(selector, value); }
  async select(): Promise<void> {}
  async click(): Promise<void> { this.submitted = true; }
}

function scripted(actions: BrowserAction[]): BrowserPlannerClient {
  let index = 0;
  return { async plan(source) { const action = actions[Math.min(index, actions.length - 1)]!; index += 1; return { action, usage: { source, input_tokens: 0, output_tokens: 0 } }; } };
}

const fingerprint = buildEnvFingerprint({ tool_inventory: [{ name: 'browser.click', schema_hash: 'v1' }], target_identity: 'fixture.test', surface_versions: {} });
let baseDir: string | undefined;
afterEach(async () => { if (baseDir) await rm(baseDir, { recursive: true, force: true }); baseDir = undefined; });

async function recordRun(): Promise<ReturnType<typeof deriveSiteMemory>> {
  baseDir = await mkdtemp(join(tmpdir(), 'rote-site-memory-'));
  const recorder = new FileBrowserAgentRunRecorder({ task: 'Register Acme Tools', envFingerprint: fingerprint, baseDir, runId: 'run-1' });
  const result = await runBrowserAgent({
    task: 'Register Acme Tools',
    page: new TwoPageSite(),
    planner: scripted([
      { kind: 'navigate', url: FORM_URL },
      { kind: 'fill', selector: '#company-name', role: 'textbox', name: 'Company name', value: 'Acme Tools' },
      { kind: 'fill', selector: '#notes', role: 'textbox', name: 'Notes', value: 'hunter2 is the password' },
      { kind: 'click', selector: '#registration-submit', role: 'button', name: 'Submit registration' },
      { kind: 'done', success: true, summary: 'registered' },
    ]),
    verifier: { async verify(capture) { const ok = capture.html.includes('complete'); return { success: ok, summary: ok ? 'ok' : 'no' }; } },
    recorder,
    maxSteps: 8,
  });
  expect(result.success).toBe(true);
  const run = await loadRecordedRun(baseDir, 'run-1');
  return deriveSiteMemory(run.events, { fingerprintHash: fingerprint.fingerprint_hash, runId: 'run-1', observedAt: '2026-08-16T00:00:00.000Z' });
}

describe('site memory fails closed', () => {
  it('learns identity, structure, and page edges from a live run — never a value, URL, or query string', async () => {
    const report = await recordRun();
    expect(report.skipped).toEqual([{ seq: 4, reason: 'terminal_done' }]);
    const kinds = report.records.map((record) => record.kind);
    expect(kinds).toEqual(expect.arrayContaining(['selector_map', 'page_edge', 'form_semantics', 'quirk']));
    const edge = report.records.find((record) => record.kind === 'page_edge' && record.action_kind === 'click');
    expect(edge).toMatchObject({ from_page_key: pageKey(FORM_URL), to_page_key: pageKey(DONE_URL), role: 'button', name: 'Submit registration' });
    expect(report.records.find((record) => record.kind === 'form_semantics')).toMatchObject({ method: 'post', safety: 'mutating', fields: [{ name: 'Company name' }, { name: 'Notes', affordance: { control: 'multi_line_text' } }] });
    const serialized = JSON.stringify(report.records);
    for (const leaked of ['Acme Tools', 'hunter2', 'topsecret', 'https://', 'fixture.test', '/vendors/']) expect(serialized).not.toContain(leaked);
    for (const record of report.records) expect(record.fingerprint_hash).toBe(fingerprint.fingerprint_hash);
  });

  it('never crosses environments: a partition holds and serves only its own fingerprint', async () => {
    const report = await recordRun();
    const store = new FileSiteMemoryStore(baseDir!);
    await store.append(fingerprint.fingerprint_hash, report.records);
    // Appending another environment's record to this partition is refused before any write.
    const foreign = { ...report.records[0]!, fingerprint_hash: 'other-env', record_id: 'foreign' };
    await expect(store.append(fingerprint.fingerprint_hash, [foreign])).rejects.toBeInstanceOf(SiteMemoryPartitionError);
    expect(await store.read('other-env')).toEqual([]);
    // A partition file that somehow contains a foreign record is corruption, not advice.
    await appendFile(siteMemoryLogPath(baseDir!, fingerprint.fingerprint_hash), `${JSON.stringify(SiteMemoryRecordSchema.parse(foreign))}\n`, 'utf8');
    await expect(store.read(fingerprint.fingerprint_hash)).rejects.toBeInstanceOf(SiteMemoryPartitionError);
    const memory = new MemorySiteMemoryStore();
    await expect(memory.append('fp-a', [foreign])).rejects.toBeInstanceOf(SiteMemoryPartitionError);
  });

  it('is append-only: interrupted writes recover from complete lines, complete-but-invalid lines surface, nothing is edited', async () => {
    const report = await recordRun();
    const store = new FileSiteMemoryStore(baseDir!);
    const half = Math.ceil(report.records.length / 2);
    await store.append(fingerprint.fingerprint_hash, report.records.slice(0, half));
    const path = siteMemoryLogPath(baseDir!, fingerprint.fingerprint_hash);
    await appendFile(path, '{"version":1,"record_id":"cut-sho', 'utf8');
    expect(await store.read(fingerprint.fingerprint_hash)).toHaveLength(half);
    await store.append(fingerprint.fingerprint_hash, report.records.slice(half));
    const all = await store.read(fingerprint.fingerprint_hash);
    expect(all).toEqual(report.records);
    // The fragment is still there, untouched — the next record started on its own line.
    expect(await readFile(path, 'utf8')).toContain('"cut-sho\n');
    // Consolidation reads the log as-is; a second observation of the same facts is counted, not merged in place.
    await store.append(fingerprint.fingerprint_hash, report.records.map((record) => ({ ...record, record_id: `${record.record_id}#2`, observed_at: '2026-08-17T00:00:00.000Z' })));
    const view = consolidateSiteMemory(await store.read(fingerprint.fingerprint_hash), { now: new Date('2026-08-17T00:00:00.000Z') });
    expect(view.facts.every((fact) => fact.observations === 2 && !fact.changed)).toBe(true);
    // A syntactically complete but invalid record is corruption — an error, never a silent skip.
    const lines = (await readFile(path, 'utf8')).split('\n');
    lines[0] = '{"broken":true}';
    await writeFile(path, lines.join('\n'), 'utf8');
    await expect(store.read(fingerprint.fingerprint_hash)).rejects.toThrow();
  });

  it('survives an interrupted write that was cut at a closing brace', async () => {
    // A crash can truncate anywhere, including just after a nested object's
    // `}`. The recovery rule used to test the last byte for a brace, so this
    // fragment read as corruption and the partition raised on every later
    // read — tier-2 memory for that environment, lost to one badly timed crash.
    const report = await recordRun();
    const store = new FileSiteMemoryStore(baseDir!);
    await store.append(fingerprint.fingerprint_hash, report.records.slice(0, 1));
    const path = siteMemoryLogPath(baseDir!, fingerprint.fingerprint_hash);
    await appendFile(path, '{"version":1,"record_id":"cut","evidence":{"a":1}', 'utf8');
    await store.append(fingerprint.fingerprint_hash, report.records.slice(1));
    expect(await store.read(fingerprint.fingerprint_hash)).toEqual(report.records);
  });
});
