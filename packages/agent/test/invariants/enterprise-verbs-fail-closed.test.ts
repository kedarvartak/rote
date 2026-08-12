import { describe, expect, it, vi } from 'vitest';
import { BrowserCapabilityUnsupportedError, DragContextMismatchError, UploadNotAllowlistedError } from '@rote/action';
import type { BrowserContextCoordinate, CapturedElement } from '@rote/browser';
import { runBrowserAgent, type BrowserAction, type BrowserPageSession, type BrowserPlannerClient } from '../../src/index.js';

// see docs/05-roadmap.md P2 item 6 (#131) — "Every verb lands with safety
// classification, redaction, settledness, and action-specific evidence; no
// arbitrary-event escape hatch." This suite pins the fail-closed exits.

const SECRET_CONTENT = 'synthetic-secret-content';
const SECRET_BASE64 = Buffer.from(SECRET_CONTENT).toString('base64');
const allowlisted = {
  file_id: 'synthetic-report',
  name: 'upload-synthetic.txt',
  mime_type: 'text/plain',
  content_base64: SECRET_BASE64,
};

function scriptedPlanner(actions: BrowserAction[]): BrowserPlannerClient {
  let index = 0;
  return {
    async plan(source) {
      const action = actions[Math.min(index, actions.length - 1)]!;
      index += 1;
      return { action, usage: { source, input_tokens: 5, output_tokens: 2 } };
    },
  };
}

function fixturePage(overrides: Partial<BrowserPageSession> = {}, elements?: CapturedElement[]): BrowserPageSession {
  return {
    async navigate() {},
    async capture() {
      return {
        url: 'https://fixture.test/controls',
        title: 'Controls',
        html: '',
        elements: elements ?? [
          { tag: 'input', attributes: { id: 'file-input', type: 'file', 'aria-label': 'Upload synthetic text' }, text: '', depth: 1 },
          { tag: 'button', attributes: { id: 'drag-source', draggable: 'true' }, text: 'Record 7', depth: 1 },
          { tag: 'button', attributes: { id: 'drop-target' }, text: 'Approved', depth: 1 },
          { tag: 'textarea', attributes: { id: 'note', 'aria-label': 'Command note' }, text: '', depth: 1 },
          { tag: 'button', attributes: { id: 'menu' }, text: 'Actions', depth: 1 },
        ],
      };
    },
    async fill() {},
    async select() {},
    async click() {},
    ...overrides,
  };
}

const passingVerifier = { async verify() { return { success: true, summary: 'verified' }; } };

describe('enterprise verbs fail closed', () => {
  it('never dispatches an upload outside the injected allowlist and names ids only', async () => {
    const upload = vi.fn();
    await expect(runBrowserAgent({
      task: 'Upload the report',
      page: fixturePage({ upload }),
      planner: scriptedPlanner([{ kind: 'upload', selector: '#file-input', fileId: 'invented-file' }]),
      verifier: passingVerifier,
      uploadFiles: [allowlisted],
      maxTargetRepairs: 0,
      clock: () => 1,
    })).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(UploadNotAllowlistedError);
      const message = (error as Error).message;
      // INVARIANT: the failure names allowlisted ids, never names/paths/content.
      expect(message).toContain('synthetic-report');
      expect(message).not.toContain('upload-synthetic.txt');
      expect(message).not.toContain(SECRET_CONTENT);
      expect(message).not.toContain(SECRET_BASE64);
      return true;
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it('fails closed when no allowlist is injected at all', async () => {
    const upload = vi.fn();
    await expect(runBrowserAgent({
      task: 'Upload the report',
      page: fixturePage({ upload }),
      planner: scriptedPlanner([{ kind: 'upload', selector: '#file-input', fileId: 'synthetic-report' }]),
      verifier: passingVerifier,
      maxTargetRepairs: 0,
      clock: () => 1,
    })).rejects.toThrow(UploadNotAllowlistedError);
    expect(upload).not.toHaveBeenCalled();
  });

  it('hands file material to the backend but keeps it out of every record', async () => {
    const upload = vi.fn(async () => {});
    const result = await runBrowserAgent({
      task: 'Upload the report',
      page: fixturePage({ upload }),
      planner: scriptedPlanner([
        { kind: 'upload', selector: '#file-input', fileId: 'synthetic-report' },
        { kind: 'done', success: true, summary: 'uploaded' },
      ]),
      verifier: passingVerifier,
      uploadFiles: [allowlisted],
      clock: () => 1,
    });
    expect(result.success).toBe(true);
    expect(upload).toHaveBeenCalledWith('#file-input', {
      name: 'upload-synthetic.txt',
      mimeType: 'text/plain',
      contentBase64: SECRET_BASE64,
    }, undefined);
    // INVARIANT: recorded steps carry the fileId reference only; the file name
    // and content exist solely on the dispatch edge (#131 acceptance).
    const recorded = JSON.stringify(result);
    expect(recorded).toContain('synthetic-report');
    expect(recorded).not.toContain(SECRET_CONTENT);
    expect(recorded).not.toContain(SECRET_BASE64);
    expect(recorded).not.toContain('upload-synthetic.txt');
    expect(result.steps[0]!.actionSafety).toBe('mutating');
  });

  it('rejects an unnormalizable chord as malformed planner output before any dispatch', async () => {
    const press = vi.fn();
    await expect(runBrowserAgent({
      task: 'Commit the note',
      page: fixturePage({ press }),
      planner: scriptedPlanner([{ kind: 'press', selector: '#note', chord: 'Hyper+Enter' } as unknown as BrowserAction]),
      verifier: passingVerifier,
      clock: () => 1,
    })).rejects.toThrow(/invalid key chord/);
    expect(press).not.toHaveBeenCalled();
  });

  it('fails typed when the backend lacks a requested verb instead of substituting an event', async () => {
    await expect(runBrowserAgent({
      task: 'Open the menu',
      page: fixturePage(),
      planner: scriptedPlanner([{ kind: 'hover', selector: '#menu' }]),
      verifier: passingVerifier,
      clock: () => 1,
    })).rejects.toThrow(BrowserCapabilityUnsupportedError);
  });

  it('stops a cross-context drag before dispatch', async () => {
    const context: BrowserContextCoordinate = {
      version: 1,
      path: [{ kind: 'frame', keyHash: 'a'.repeat(16), originHash: 'b'.repeat(16) }],
      contextHash: 'c'.repeat(16),
      documentToken: 'd'.repeat(16),
    };
    const dragAndDrop = vi.fn();
    await expect(runBrowserAgent({
      task: 'Approve record 7',
      page: fixturePage({ dragAndDrop }, [
        { tag: 'button', attributes: { id: 'drag-source', draggable: 'true' }, text: 'Record 7', depth: 1 },
        { tag: 'button', attributes: { id: 'drop-target' }, text: 'Approved', depth: 1, context },
      ]),
      planner: scriptedPlanner([{ kind: 'dragAndDrop', selector: '#drag-source', targetSelector: '#drop-target' }]),
      verifier: passingVerifier,
      maxTargetRepairs: 0,
      clock: () => 1,
    })).rejects.toThrow(DragContextMismatchError);
    expect(dragAndDrop).not.toHaveBeenCalled();
  });

  it('records drag reaction evidence without ever enforcing it', async () => {
    const dragAndDrop = vi.fn(async () => {});
    const result = await runBrowserAgent({
      task: 'Approve record 7',
      page: fixturePage({ dragAndDrop }),
      planner: scriptedPlanner([
        { kind: 'dragAndDrop', selector: '#drag-source', targetSelector: '#drop-target' },
        { kind: 'done', success: true, summary: 'dropped' },
      ]),
      verifier: passingVerifier,
      clock: () => 1,
    });
    expect(result.success).toBe(true);
    expect(dragAndDrop).toHaveBeenCalledWith('#drag-source', '#drop-target', undefined);
    // A no-op drop shows up as an unenforced no-reaction, never a step failure:
    // authoritative outcomes are decided by E7.4 evidence, not DOM churn.
    expect(result.steps[0]!.postActionEvidence).toMatchObject({
      action_kind: 'dragAndDrop',
      strength: 'reaction',
      classification: 'no_observable_reaction',
      passed: false,
      enforced: false,
    });
    expect(result.steps[0]!.targetResolution?.selector).toBe('#drop-target');
    expect(result.steps[0]!.actionSafety).toBe('mutating');
  });
});
