import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeKeyChord } from '@rote/action';
import { findChromeExecutable, LaunchingCdpBrowserBackend, type CdpPage } from '@rote/browser';
import { parseEnterpriseContractProtocol } from '../src/enterprise-contract.js';
import { EnterpriseFixtureServer } from '../src/enterprise-oracle.js';

// see docs/05-roadmap.md P2 item 6 (#131) — the E7.1 complex-control contract
// must pass through the *product verbs* (CdpPage.hover/press/upload/dragAndDrop),
// with the frozen server oracle as the only success signal. T29 drove the same
// fixture with raw page JavaScript; this suite retires that gap.

const protocolPath = fileURLToPath(new URL('../../../scripts/bench/enterprise/protocol.json', import.meta.url));

let fixtureServer: EnterpriseFixtureServer | undefined;
let backends: LaunchingCdpBrowserBackend[] = [];
let pages: CdpPage[] = [];

afterEach(async () => {
  for (const page of pages) page.close();
  pages = [];
  await Promise.all(backends.map((backend) => backend.close()));
  backends = [];
  await fixtureServer?.close();
  fixtureServer = undefined;
});

describe('E7.5 verbs against the real-Chrome enterprise control contract', () => {
  it.each([1, 2])('dispatches hover, chord, allowlisted upload, and drag through product verbs with exact oracles (repetition %i)', async () => {
    if (process.env['ROTE_RUN_CDP_TESTS'] !== '1') return;
    const chromePath = findChromeExecutable();
    expect(chromePath, 'E7.5 verb qualification requires Chrome/Chromium').toBeDefined();
    if (!chromePath) return;
    fixtureServer = new EnterpriseFixtureServer(resolve('../../fixtures/enterprise'));
    await fixtureServer.start();
    await reset();
    const backend = new LaunchingCdpBrowserBackend({ chromePath, windowSize: { width: 1440, height: 900 } });
    backends.push(backend);
    const page = await backend.openPage();
    pages.push(page);

    await page.navigate(fixtureServer.url('/complex-controls.html'));

    // Hover is a real verb, not CSS state: the menu item must become clickable
    // only after the grounded hover dispatch.
    await page.hover('[data-hover-menu]');
    expect(await page.evaluate<string>(`document.querySelector('[data-hover-menu]').dataset.open ?? ''`)).toBe('true');
    await page.click('[role="menuitem"]');
    expect(projectEvents((await expectEvents('controls-contract', 1)).events)).toEqual(await expectedEvents('E7-CONTROL-HOVER'));

    await page.fill('[data-chord-input]', 'Synthetic approval note');
    await page.press('[data-chord-input]', normalizeKeyChord('Control+Enter'));
    const afterChord = await expectEvents('controls-contract', 2);
    expect(projectEvents(afterChord.events)).toEqual(expect.arrayContaining(await expectedEvents('E7-CONTROL-CHORD')));

    // The uploaded bytes come from the frozen fixture file, so the oracle's
    // pinned content digest can only pass if the exact allowlisted content
    // reached the page.
    const uploadBytes = await readFile(resolve('../../fixtures/enterprise/upload-synthetic.txt'));
    await page.upload('[data-upload]', {
      name: 'upload-synthetic.txt',
      mimeType: 'text/plain',
      contentBase64: uploadBytes.toString('base64'),
    });
    const afterUpload = await expectEvents('controls-contract', 3);
    expect(projectEvents(afterUpload.events)).toEqual(expect.arrayContaining(await expectedEvents('E7-CONTROL-UPLOAD')));

    await page.dragAndDrop('[data-drag-source]', '[data-drop-target]');
    const afterDrag = await expectEvents('controls-contract', 4);
    expect(projectEvents(afterDrag.events)).toEqual(expect.arrayContaining(await expectedEvents('E7-CONTROL-DRAG')));

    // The no-op control mutates unrelated DOM but must add nothing to the
    // authoritative record — reaction is not evidence (#54/#130).
    await page.click('[data-no-op]');
    expect(await page.evaluate<boolean>(`[...document.querySelectorAll('aside')].some((node) => node.textContent === 'Background refresh complete')`)).toBe(true);
    expect((await snapshot('controls-contract')).events).toHaveLength(4);

    // A non-draggable source is a typed dispatch failure, never a silent click.
    await expect(page.dragAndDrop('[data-no-op]', '[data-drop-target]')).rejects.toThrow('drag source is not draggable');
    expect((await snapshot('controls-contract')).events).toHaveLength(4);
  }, 60000);
});

interface ExpectedEvent {
  kind: string;
  target_key: string;
  payload_sha256: string;
}

interface Snapshot {
  generation: number;
  events: Array<ExpectedEvent & { event_id: string; task_id: string }>;
}

async function expectedEvents(caseId: string): Promise<ExpectedEvent[]> {
  const protocol = parseEnterpriseContractProtocol(JSON.parse(await readFile(protocolPath, 'utf8')));
  const contract = protocol.cases.find((candidate) => candidate.id === caseId);
  if (!contract || contract.oracle.kind !== 'server_state') throw new Error(`server-state contract missing: ${caseId}`);
  return contract.oracle.expected_events.map((event) => ({
    kind: event.kind,
    target_key: event.target_key,
    payload_sha256: event.payload_sha256,
  }));
}

function projectEvents(events: Snapshot['events']): ExpectedEvent[] {
  return events.map(({ kind, target_key, payload_sha256 }) => ({ kind, target_key, payload_sha256 }));
}

async function reset(): Promise<void> {
  if (!fixtureServer) throw new Error('fixture server missing');
  const response = await fetch(fixtureServer.url('/api/reset'), { method: 'POST' });
  if (!response.ok) throw new Error(`fixture reset failed: ${response.status}`);
}

async function snapshot(taskId: string): Promise<Snapshot> {
  if (!fixtureServer) throw new Error('fixture server missing');
  const response = await fetch(fixtureServer.url(`/api/oracle?task_id=${taskId}`));
  if (!response.ok) throw new Error(`oracle query failed: ${response.status}`);
  return response.json() as Promise<Snapshot>;
}

async function expectEvents(taskId: string, count: number): Promise<Snapshot> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const current = await snapshot(taskId);
    if (current.events.length === count) return current;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error(`enterprise fixture did not reach ${count} authoritative events for ${taskId}`);
}
