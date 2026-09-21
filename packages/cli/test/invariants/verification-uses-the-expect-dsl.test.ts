import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BrowserPageSession, BrowserPlannerClient } from '@rote/agent';
import type { BrowserExpect, CapturedElement } from '@rote/core';
import { runPaths } from '@rote/recorder';
import { runBrowserTask, type BrowserTaskBackend, type BrowserTaskResult } from '../../src/index.js';

// see docs/02-architecture.md "Expect DSL v1" and CLAUDE.md sacred invariant 1
// ("never silently wrong"). Final verification is the oracle that decides
// whether a run succeeded, so it must be exactly as strict as the evaluator
// that decides live action postconditions — one implementation, not two that
// can drift. The CLI previously had its own, and it had drifted: it matched
// text in elements the page does not display.

let root: string | undefined;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

const HIDDEN_BANNER: CapturedElement = {
  tag: 'div', attributes: { style: 'display:none' }, text: 'Registration complete', depth: 0,
};
const VISIBLE_BANNER: CapturedElement = {
  tag: 'div', attributes: {}, text: 'Registration complete', depth: 0,
};
const FILLED_INPUT: CapturedElement = {
  tag: 'input', attributes: { id: 'vendor', value: 'Acme' }, depth: 0, text: '',
};

describe('invariant: final verification is the Expect DSL, evaluated once', () => {
  it('does not accept text the page does not display', async () => {
    // The regression this suite exists for: a `display:none` success banner
    // satisfied the old inline check, so a run that never succeeded reported
    // success — invariant 1's exact failure mode.
    const result = await verify([{ text_visible: 'Registration complete' }], [HIDDEN_BANNER]);
    expect(result.success).toBe(false);
    expect(result.summary).toMatch(/text "Registration complete" not visible/);
  });

  it('accepts the same text when the page displays it', async () => {
    const result = await verify([{ text_visible: 'Registration complete' }], [VISIBLE_BANNER]);
    expect(result.success).toBe(true);
  });

  it.each([
    ['selector_visible passes on a present element', [{ selector_visible: '#vendor' }] as BrowserExpect[], [FILLED_INPUT], true],
    ['selector_visible fails on an absent element', [{ selector_visible: '#missing' }] as BrowserExpect[], [FILLED_INPUT], false],
    ['selector_absent passes when the element is gone', [{ selector_absent: '#gone' }] as BrowserExpect[], [FILLED_INPUT], true],
    ['selector_absent fails while the element is still shown', [{ selector_absent: '#vendor' }] as BrowserExpect[], [FILLED_INPUT], false],
    ['input_value passes on an exact match', [{ input_value: '#vendor', equals: 'Acme' }] as BrowserExpect[], [FILLED_INPUT], true],
    ['input_value fails on any other value', [{ input_value: '#vendor', equals: 'Other' }] as BrowserExpect[], [FILLED_INPUT], false],
  ])('%s', async (_name, checks, elements, expected) => {
    const result = await verify(checks, elements);
    expect(result.success).toBe(expected);
  });

  it('requires every check to pass, and names each one that did not', async () => {
    const result = await verify(
      [{ text_visible: 'Registration complete' }, { selector_visible: '#missing' }, { url_contains: '/done' }],
      [VISIBLE_BANNER],
    );
    expect(result.success).toBe(false);
    expect(result.summary).toMatch(/selector "#missing" not visible/);
    expect(result.summary).toMatch(/does not contain "\/done"/);
    expect(result.summary).not.toMatch(/Registration complete/);
  });

  it('refuses a run with no oracle at all rather than passing it vacuously', async () => {
    root = await mkdtemp(join(tmpdir(), 'rote-no-oracle-'));
    await expect(runBrowserTask(
      { task: 'Complete task', url: 'https://portal.test/start', baseDir: root, verifyChecks: [] },
      { backend: new FakeBackend(new FakePage([VISIBLE_BANNER])), planner: donePlanner },
    )).rejects.toThrow(/at least one verification check/);
  });

  it('teaches a distilled playbook exactly the checks that decided success', async () => {
    // Recorded `checks` are what a later replay is verified against; if they
    // were a different list, a run certified by one oracle would be replayed
    // under another.
    const checks: BrowserExpect[] = [{ text_visible: 'Registration complete' }, { selector_visible: '#vendor' }];
    const result = await verify(checks, [VISIBLE_BANNER, FILLED_INPUT]);
    expect(result.success).toBe(true);
    expect(await recordedVerifyChecks(result.runId)).toEqual(checks);
  });
});

/** The `checks` the run recorded on its terminal event — what a distilled playbook learns. */
async function recordedVerifyChecks(runId: string): Promise<unknown> {
  const lines = (await readFile(runPaths(root!, runId).trajectoryPath, 'utf8')).trim().split('\n');
  // The verification rides on the terminal step event; find it by shape rather
  // than by pinning this suite to the trajectory's nesting.
  const found = lines.map((line) => findVerificationChecks(JSON.parse(line))).filter((checks) => checks !== undefined);
  return found.at(-1);
}

function findVerificationChecks(node: unknown): unknown {
  if (node === null || typeof node !== 'object') return undefined;
  const record = node as Record<string, unknown>;
  const verification = record['verification'];
  if (verification && typeof verification === 'object' && 'checks' in verification) {
    return (verification as { checks: unknown }).checks;
  }
  for (const value of Object.values(record)) {
    const found = findVerificationChecks(value);
    if (found !== undefined) return found;
  }
  return undefined;
}

async function verify(verifyChecks: BrowserExpect[], elements: CapturedElement[]): Promise<BrowserTaskResult> {
  root = await mkdtemp(join(tmpdir(), 'rote-verify-oracle-'));
  const result = await runBrowserTask(
    { task: 'Complete task', url: 'https://portal.test/start', baseDir: root, verifyChecks },
    { backend: new FakeBackend(new FakePage(elements)), planner: donePlanner },
  );
  return result;
}

const donePlanner: BrowserPlannerClient = {
  async plan(source) {
    return {
      action: { kind: 'done', success: true, summary: 'agent believes it finished' },
      usage: { source, input_tokens: 10, output_tokens: 2 },
    };
  },
};

class FakeBackend implements BrowserTaskBackend {
  constructor(private readonly page: BrowserPageSession) {}
  async openPage(): Promise<BrowserPageSession> { return this.page; }
  async close(): Promise<void> {}
}

class FakePage implements BrowserPageSession {
  navigations: string[] = [];
  constructor(private readonly elements: CapturedElement[]) {}
  async navigate(url: string): Promise<void> { this.navigations.push(url); }
  async capture() {
    return {
      url: this.navigations.at(-1) ?? 'about:blank',
      title: 'Vendor portal',
      html: '<main></main>',
      elements: this.elements,
    };
  }
  async fill(): Promise<void> {}
  async select(): Promise<void> {}
  async click(): Promise<void> {}
}
