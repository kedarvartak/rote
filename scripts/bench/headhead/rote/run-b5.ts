import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parsePlaybookYaml } from '@rote/core';
import { findChromeExecutable, FixtureSiteServer, LaunchingCdpBrowserBackend } from '@rote/browser';
import { BrowserToolCaller, runPlaybook } from '@rote/executor';
import { B5MutationRecordSchema, type B5MutationRecord } from '@rote/bench';

const mutations = [
  { id: 'fields-renamed', expectation: 'recover' as const },
  { id: 'submit-renamed', expectation: 'recover' as const },
  { id: 'wrappers', expectation: 'recover' as const },
  { id: 'stale-selector-decoys', expectation: 'recover' as const },
  { id: 'ambiguous-company', expectation: 'fail_closed' as const },
];
const exactText = 'Vendor registration complete | company_name=Northwind Supply | contact_email=ap@northwind.test | tax_id=84-1129930 | address_line1=18 Harbor Way | city=Portland | postal_code=97209 | country=US | phone=503-555-0148';
const params = {
  base_url: '', company_name: 'Northwind Supply', contact_email: 'ap@northwind.test',
  tax_id: '84-1129930', address_line1: '18 Harbor Way', city: 'Portland',
  postal_code: '97209', country: 'US', phone: '503-555-0148',
};

const outPath = resolve(process.argv[2] ?? 'bench-out/b5/records.jsonl');
const repetitions = Number(process.argv[3] ?? '18');
if (!Number.isInteger(repetitions) || repetitions < 1) throw new Error('repetitions must be a positive integer');
await mkdir(dirname(outPath), { recursive: true });
const existing = await readExisting(outPath);
const identities = new Set(existing.map((record) => `${record.mutation}:${record.repetition}`));
if (!existing.length) await writeFile(outPath, '', { flag: 'wx' });

const chromePath = findChromeExecutable();
if (!chromePath) throw new Error('Chrome is required for B5 certification');
const server = new FixtureSiteServer({ rootDir: resolve('fixtures/sites') });
const backend = new LaunchingCdpBrowserBackend({ chromePath, windowSize: { width: 1920, height: 1080 } });
const playbook = parsePlaybookYaml(await readFile(resolve('fixtures/playbooks/browser-b2-stateful.yaml'), 'utf8'));
await server.start();
try {
  for (const mutation of mutations) {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      const identity = `${mutation.id}:${repetition}`;
      if (identities.has(identity)) continue;
      const page = await backend.openPage();
      const initialUrl = `${server.url('b2-vendor-drift.html')}?mutation=${mutation.id}`;
      const started = performance.now();
      try {
        const result = await runPlaybook(playbook, { ...params, base_url: new URL(initialUrl).origin, initial_url: initialUrl }, {
          toolCaller: new BrowserToolCaller(page),
          llmClient: { async complete() { throw new Error('B5 replay unexpectedly requested an LLM call'); } },
          envFingerprint: {
            tool_inventory: [{ name: 'browser.cdp', schema_hash: 'b5-v1' }],
            target_identity: '127.0.0.1', surface_versions: { fixture: 'b5-v1' },
            fingerprint_hash: '0'.repeat(64),
          },
          taskSpec: `B5 ${mutation.id}`,
          runId: `b5-${mutation.id}-r${String(repetition).padStart(2, '0')}`,
          baseDir: resolve(dirname(outPath), 'runs'),
        });
        const captured = await page.capture();
        const visibleText = [captured.title, ...captured.elements.map((element) => element.text)].join(' ');
        const exactLiveVerification = visibleText.includes(exactText);
        const outcome: B5MutationRecord['outcome'] = result.outcome === 'success'
          ? exactLiveVerification && result.repairedStepIds.length > 0 ? 'repaired_success' : 'silent_failure'
          : result.outcome === 'fallback' && !exactLiveVerification ? 'detected_fallback' : 'failure';
        const record = B5MutationRecordSchema.parse({
          protocol_id: 'p1-b5-b2-drift-v1', mutation: mutation.id,
          expectation: mutation.expectation, repetition, outcome,
          repaired_steps: result.repairedStepIds.length, logical_tokens: 0,
          duration_ms: performance.now() - started, exact_live_verification: exactLiveVerification,
        });
        await appendFile(outPath, `${JSON.stringify(record)}\n`);
        identities.add(identity);
        console.log(`${identity} ${outcome} repairs=${record.repaired_steps} ${record.duration_ms.toFixed(0)}ms`);
      } finally {
        page.close();
      }
    }
  }
} finally {
  await backend.close();
  await server.close();
}

async function readExisting(path: string): Promise<B5MutationRecord[]> {
  try {
    const text = await readFile(path, 'utf8');
    return text.split('\n').filter(Boolean).map((line) => B5MutationRecordSchema.parse(JSON.parse(line)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
