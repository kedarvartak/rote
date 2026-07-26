import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildEnvFingerprint, RunManifestSchema, TrajectoryEventSchema } from '@rote/core';
import {
  BrowserActionSchema,
  FileBrowserAgentRunRecorder,
  runBrowserAgent,
  type BrowserPageSession,
  type BrowserPlannerClient,
  type BrowserPlannerRequest,
} from '../../src/index.js';

let baseDir: string | undefined;
afterEach(async () => { if (baseDir) await rm(baseDir, { recursive: true, force: true }); baseDir = undefined; });

describe('invariant: eviction may lose recall but never invent it', () => {
  it('rejects a failure classification attached to claimed success', () => {
    expect(BrowserActionSchema.safeParse({
      kind: 'done', success: true, summary: 'done', failureClassification: 'recall_unavailable',
    }).success).toBe(false);
    expect(BrowserActionSchema.safeParse({
      kind: 'done', success: false, summary: 'trust me', failureClassification: 'verification_failed',
    }).success).toBe(false);
  });

  it('fails cleanly with an auditable classification when an earlier-page fact is unavailable', async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'rote-evicted-recall-'));
    const requests: BrowserPlannerRequest[] = [];
    let verifierCalls = 0;
    const planner: BrowserPlannerClient = {
      async plan(source, request) {
        requests.push(request);
        if (request.step === 0) {
          return {
            action: { kind: 'navigate', url: PRODUCT_B },
            usage: { source, input_tokens: 10, output_tokens: 2 },
          };
        }
        return {
          action: {
            kind: 'done', success: false, failureClassification: 'recall_unavailable',
            summary: 'Cannot compare: Product A price is no longer available after navigation.',
          },
          usage: { source, input_tokens: 8, output_tokens: 3 },
        };
      },
    };
    const recorder = new FileBrowserAgentRunRecorder({
      task: TASK,
      envFingerprint: buildEnvFingerprint({ tool_inventory: [], target_identity: 'catalog.test', surface_versions: {} }),
      baseDir,
      runId: 'recall-unavailable-run',
      clock: sequenceClock(),
    });

    const result = await runBrowserAgent({
      task: TASK,
      page: new RecallFixturePage(),
      planner,
      verifier: { async verify() { verifierCalls += 1; return { success: true, summary: 'must remain unreachable' }; } },
      recorder,
      clock: () => 100,
    });

    expect(result).toMatchObject({
      success: false,
      failureClassification: 'recall_unavailable',
      summary: 'Cannot compare: Product A price is no longer available after navigation.',
    });
    expect(verifierCalls).toBe(0);
    expect(requests[0]!.context.volatileSuffix).toContain('Product A price: $10');
    expect(requests[1]!.context.volatileSuffix).not.toContain('Product A price: $10');
    expect(requests[1]!.context.volatileSuffix).toContain('Recall boundary:');
    expect(requests[1]!.previousActions).toEqual([{ kind: 'navigate', url: PRODUCT_B }]);

    const run = join(baseDir, 'runs', 'recall-unavailable-run');
    const manifest = RunManifestSchema.parse(JSON.parse(await readFile(join(run, 'manifest.json'), 'utf8')));
    const events = (await readFile(join(run, 'trajectory.jsonl'), 'utf8')).trim().split('\n')
      .map((line) => TrajectoryEventSchema.parse(JSON.parse(line)));
    expect(manifest.outcome).toBe('failure');
    expect(events).toHaveLength(2);
    expect(events[1]!.args).toMatchObject({
      kind: 'done', success: false, failureClassification: 'recall_unavailable',
    });
  });

  it('lets independent verification reject a fabricated comparison after recall was evicted', async () => {
    const requests: BrowserPlannerRequest[] = [];
    const planner: BrowserPlannerClient = {
      async plan(source, request) {
        requests.push(request);
        return {
          action: request.step === 0
            ? { kind: 'navigate', url: PRODUCT_B }
            : { kind: 'done', success: true, summary: 'Product A is cheaper.' },
          usage: { source, input_tokens: 10, output_tokens: 2 },
        };
      },
    };

    const result = await runBrowserAgent({
      task: TASK,
      page: new RecallFixturePage(),
      planner,
      verifier: {
        async verify() {
          return { success: false, summary: 'Comparison wrong: Product B ($9) is cheaper than Product A ($10).' };
        },
      },
      clock: () => 100,
    });

    expect(requests[1]!.context.volatileSuffix).not.toContain('Product A price: $10');
    expect(result).toMatchObject({
      success: false,
      failureClassification: 'verification_failed',
      summary: 'Comparison wrong: Product B ($9) is cheaper than Product A ($10).',
    });
  });
});

const PRODUCT_A = 'https://catalog.test/product-a';
const PRODUCT_B = 'https://catalog.test/product-b';
const TASK = 'Compare Product A and Product B prices and report which is cheaper.';

class RecallFixturePage implements BrowserPageSession {
  private url = PRODUCT_A;
  async navigate(url: string): Promise<void> { this.url = url; }
  async capture() {
    const isA = this.url === PRODUCT_A;
    const name = isA ? 'Product A price: $10' : 'Product B price: $9';
    return {
      url: this.url,
      title: isA ? 'Product A' : 'Product B',
      html: `<main><h1>${name}</h1></main>`,
      elements: [{ tag: 'h1', attributes: {}, text: name, depth: 0 }],
    };
  }
  async fill(): Promise<void> {}
  async select(): Promise<void> {}
  async click(): Promise<void> {}
}

function sequenceClock(): () => Date {
  let time = Date.parse('2026-07-24T00:00:00.000Z');
  return () => new Date(time++);
}
