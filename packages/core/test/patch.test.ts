import { describe, it, expect } from 'vitest';
import { PlaybookSchema } from '../src/schemas/playbook.js';
import { applyPatch, UnknownStepError, PlaybookMismatchError } from '../src/schemas/patch.js';

function makePlaybook() {
  return PlaybookSchema.parse({
    playbook: 'demo',
    version: 1,
    task_signature: {
      intent_description: 'demo',
      env_fingerprint: { domain: 'example.com', tool_prefixes: ['browser.'] },
    },
    params: [],
    steps: [
      {
        id: 'a',
        kind: 'deterministic',
        tool: 'browser.navigate',
        args: { url: 'https://example.com' },
      },
    ],
    verify: [{ nonempty: true }],
  });
}

describe('applyPatch', () => {
  it('replaces the target step and bumps the version', () => {
    const playbook = makePlaybook();
    const patched = applyPatch(playbook, {
      playbook: 'demo',
      base_version: 1,
      step_id: 'a',
      replacement_step: {
        id: 'a',
        kind: 'deterministic',
        tool: 'browser.navigate',
        args: { url: 'https://example.com/new' },
        depends_on: [],
        on_fail: 'fallback',
      },
      reason: 'selector moved',
      created_by: 'repair',
      run_id: 'run-1',
    });

    expect(patched.version).toBe(2);
    expect(patched.steps[0]).toMatchObject({ args: { url: 'https://example.com/new' } });
    expect(playbook.version).toBe(1); // original untouched — never mutated
  });

  it('throws UnknownStepError for a nonexistent step_id', () => {
    const playbook = makePlaybook();
    expect(() =>
      applyPatch(playbook, {
        playbook: 'demo',
        base_version: 1,
        step_id: 'does-not-exist',
        replacement_step: playbook.steps[0],
        reason: 'x',
        created_by: 'human',
        run_id: 'r',
      }),
    ).toThrow(UnknownStepError);
  });

  it('throws PlaybookMismatchError when the patch targets a different playbook', () => {
    const playbook = makePlaybook();
    expect(() =>
      applyPatch(playbook, {
        playbook: 'other',
        base_version: 1,
        step_id: 'a',
        replacement_step: playbook.steps[0],
        reason: 'x',
        created_by: 'human',
        run_id: 'r',
      }),
    ).toThrow(PlaybookMismatchError);
  });
});
