import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { findChromeExecutable, LaunchingCdpBrowserBackend, type CdpPage } from '@rote/browser';
import { parseEnterpriseContractProtocol } from '../src/enterprise-contract.js';
import { EnterpriseFixtureServer } from '../src/enterprise-oracle.js';

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

describe('enterprise corpus real-Chrome controls', () => {
  it.each([1, 2])('is deterministic across reloads, exact server oracles, 60 SPA transitions, and two process restarts (repetition %i)', async () => {
    if (process.env['ROTE_RUN_CDP_TESTS'] !== '1') return;
    const chromePath = findChromeExecutable();
    expect(chromePath, 'explicit enterprise fixture smoke requires Chrome/Chromium').toBeDefined();
    if (!chromePath) return;
    fixtureServer = new EnterpriseFixtureServer(resolve('../../fixtures/enterprise'));
    await fixtureServer.start();
    await reset();
    const page = await openPage(chromePath);

    await page.navigate(fixtureServer.url('/repeated-grid.html'));
    const firstGrid = await gridSignature(page);
    await page.navigate(fixtureServer.url('/repeated-grid.html'));
    expect(await gridSignature(page)).toEqual(firstGrid);
    expect(firstGrid.filter((control) => control.name === 'Approve invoice')).toHaveLength(6);
    await page.click('[data-row-key="invoice-1042"] button');
    expect(projectEvents((await expectEvents('grid-contract', 1)).events)).toEqual(await expectedEvents('E7-GRID-EXACT'));

    await reset();
    await page.navigate(fixtureServer.url('/repeated-grid.html'));
    await page.click('[data-remount]');
    await page.click('[data-virtual-action]');
    expect(projectEvents((await expectEvents('grid-contract', 1)).events)).toEqual(await expectedEvents('E7-GRID-VIRTUALIZED'));

    await reset();
    await page.navigate(fixtureServer.url('/frame-host.html'));
    const frameOrigins = await page.evaluate<string[]>(`[...document.querySelectorAll('iframe')].map((frame) => new URL(frame.src).origin)`);
    expect(new Set(frameOrigins).size).toBe(2);
    expect(await page.evaluate<{ old_connected: boolean; new_epoch: string }>(`(() => {
      const oldFrame = document.querySelector('[data-context-key="same-workspace"]');
      document.querySelector('[data-remount-same-frame]').click();
      return {
        old_connected: oldFrame.isConnected,
        new_epoch: document.querySelector('[data-context-key="same-workspace"]').dataset.contextEpoch,
      };
    })()`)).toEqual({ old_connected: false, new_epoch: '2' });
    await page.navigate(fixtureServer.url('/frame-level-two.html?scope=same'));
    await page.click('button');
    expect(projectEvents((await expectEvents('frame-contract', 1)).events)).toEqual(await expectedEvents('E7-FRAME-SAME'));

    await reset();
    await page.navigate(fixtureServer.crossOriginUrl('/frame-level-two.html?scope=cross'));
    await page.click('button');
    expect(projectEvents((await expectEvents('frame-contract', 1)).events)).toEqual(await expectedEvents('E7-FRAME-CROSS'));

    await reset();
    await page.navigate(fixtureServer.url('/shadow-controls.html'));
    await page.evaluate<void>(`document.querySelector('#open-host').shadowRoot.querySelector('#nested-host').shadowRoot.querySelector('button').click()`);
    expect(projectEvents((await expectEvents('shadow-contract', 1)).events)).toEqual(await expectedEvents('E7-SHADOW-OPEN'));
    expect(await page.evaluate<boolean>(`document.querySelector('#closed-host').shadowRoot === null`)).toBe(true);

    await reset();
    await page.navigate(fixtureServer.url('/complex-controls.html'));
    expect(await page.evaluate<{ filename: string; path: string }>(`(() => {
      const link = document.querySelector('[data-download]');
      return { filename: link.download, path: new URL(link.href).pathname };
    })()`)).toEqual({ filename: 'enterprise-report.txt', path: '/enterprise-report.txt' });
    await page.evaluate<void>(`(() => {
      const menu = document.querySelector('[data-hover-menu]');
      menu.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
      menu.querySelector('[role="menuitem"]').click();
      const input = document.querySelector('[data-chord-input]');
      input.value = 'Synthetic approval note';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
      const fileInput = document.querySelector('[data-upload]');
      const transfer = new DataTransfer();
      transfer.items.add(new File(['Synthetic upload payload for E7.1.\\n'], 'upload-synthetic.txt', { type: 'text/plain' }));
      fileInput.files = transfer.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      const drag = new DataTransfer();
      document.querySelector('[data-drag-source]').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: drag }));
      document.querySelector('[data-drop-target]').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: drag }));
      document.querySelector('[data-no-op]').click();
    })()`);
    expect(await page.evaluate<boolean>(`[...document.querySelectorAll('aside')].some((node) => node.textContent === 'Background refresh complete')`)).toBe(true);
    const controls = await expectEvents('controls-contract', 4);
    const expectedControls = (await Promise.all([
      expectedEvents('E7-CONTROL-HOVER'),
      expectedEvents('E7-CONTROL-CHORD'),
      expectedEvents('E7-CONTROL-UPLOAD'),
      expectedEvents('E7-CONTROL-DRAG'),
    ])).flat();
    expect(projectEvents(controls.events).sort(byKind)).toEqual(expectedControls.sort(byKind));

    await reset();
    await page.navigate(fixtureServer.url('/spa-endurance.html'));
    for (let transition = 1; transition <= 60; transition += 1) {
      await page.click('[data-spa-next]');
      await waitFor(async () => (await snapshot('spa-contract')).spa_transition_count === transition);
    }
    const spa = await snapshot('spa-contract');
    expect(spa.spa_transition_count).toBe(60);
    expect(projectEvents(spa.events)).toEqual(await expectedEvents('E7-SPA-60'));

    await reset();
    await commitCheckpoint(page, 1);
    page.close();
    pages = pages.filter((candidate) => candidate !== page);
    await backends[0]?.close();
    backends = [];
    const secondProcessPage = await openPage(chromePath);
    await secondProcessPage.navigate(fixtureServer.url('/spa-endurance.html'));
    await commitCheckpoint(secondProcessPage, 2);
    secondProcessPage.close();
    pages = pages.filter((candidate) => candidate !== secondProcessPage);
    await backends[0]?.close();
    backends = [];
    const thirdProcessPage = await openPage(chromePath);
    await thirdProcessPage.navigate(fixtureServer.url('/spa-endurance.html'));
    await commitCheckpoint(thirdProcessPage, 3);
    const continuation = await snapshot('continuation-contract');
    expect(projectEvents(continuation.events)).toEqual(await expectedEvents('E7-CONTINUATION-RESTART'));
  }, 120000);
});

interface ExpectedEvent {
  kind: string;
  target_key: string;
  payload_sha256: string;
}

interface Snapshot {
  generation: number;
  events: Array<ExpectedEvent & { event_id: string; task_id: string }>;
  spa_transition_count: number;
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

function byKind(left: ExpectedEvent, right: ExpectedEvent): number {
  return left.kind.localeCompare(right.kind);
}

async function openPage(chromePath: string): Promise<CdpPage> {
  const backend = new LaunchingCdpBrowserBackend({ chromePath, windowSize: { width: 1440, height: 900 } });
  backends.push(backend);
  const page = await backend.openPage();
  pages.push(page);
  return page;
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
  await waitFor(async () => (await snapshot(taskId)).events.length === count);
  return snapshot(taskId);
}

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error('enterprise fixture did not reach expected authoritative state');
}

async function gridSignature(page: CdpPage): Promise<Array<{ name: string; target: string }>> {
  return page.evaluate<Array<{ name: string; target: string }>>(`
    [...document.querySelectorAll('button')].map((button) => ({
      name: button.getAttribute('aria-label') ?? button.textContent.trim(),
      target: button.dataset.fixtureTargetKey ?? '',
    }))
  `);
}

async function commitCheckpoint(page: CdpPage, checkpoint: number): Promise<void> {
  await page.evaluate<void>(`(() => {
    document.querySelector('[data-checkpoint-number]').value = '${checkpoint}';
    document.querySelector('[data-checkpoint]').click();
  })()`);
  await expectEvents('continuation-contract', checkpoint);
}
