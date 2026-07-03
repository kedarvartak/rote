import { describe, it, expect } from 'vitest';
import { PlaybookSchema, type Step } from '../src/schemas/playbook.js';

function basePlaybook(overrides: Record<string, unknown> = {}) {
  return {
    playbook: 'submit-vendor-invoice',
    version: 1,
    task_signature: {
      intent_description: 'Submit a vendor invoice through the portal',
      env_fingerprint: { domain: 'vendors.acme.com', tool_prefixes: ['browser.'] },
    },
    params: [{ name: 'amount', type: 'money' }],
    steps: [
      {
        id: 'open_portal',
        kind: 'deterministic',
        tool: 'browser.navigate',
        args: { url: 'https://vendors.acme.com/invoices' },
        expect: { selector_visible: '#invoice-table' },
      },
      {
        id: 'fill_form',
        kind: 'deterministic',
        depends_on: ['open_portal'],
        tool: 'browser.fill',
        args: { selector: '#amount', value: '{{amount}}' },
        expect: { input_value: '#amount', equals: '{{amount}}' },
      },
    ],
    verify: [{ text_visible: 'Invoice submitted' }],
    ...overrides,
  };
}

describe('PlaybookSchema', () => {
  it('accepts a well-formed playbook', () => {
    const result = PlaybookSchema.safeParse(basePlaybook());
    expect(result.success).toBe(true);
  });

  it('rejects duplicate step ids', () => {
    const p = basePlaybook();
    (p.steps as Record<string, unknown>[])[1] = {
      ...(p.steps as Record<string, unknown>[])[1],
      id: 'open_portal',
    };
    expect(PlaybookSchema.safeParse(p).success).toBe(false);
  });

  it('rejects depends_on referencing an unknown step', () => {
    const p = basePlaybook();
    (p.steps as Record<string, unknown>[])[1] = {
      ...(p.steps as Record<string, unknown>[])[1],
      depends_on: ['does_not_exist'],
    };
    expect(PlaybookSchema.safeParse(p).success).toBe(false);
  });

  it('rejects a cyclic depends_on graph', () => {
    const p = basePlaybook();
    (p.steps as Record<string, unknown>[])[0] = {
      ...(p.steps as Record<string, unknown>[])[0],
      depends_on: ['fill_form'],
    };
    expect(PlaybookSchema.safeParse(p).success).toBe(false);
  });

  it('rejects an unknown step kind', () => {
    const p = basePlaybook();
    (p.steps as Record<string, unknown>[])[0] = {
      ...(p.steps as Record<string, unknown>[])[0],
      kind: 'mystery',
    };
    expect(PlaybookSchema.safeParse(p).success).toBe(false);
  });

  it('rejects a param reference with no declared param', () => {
    const p = basePlaybook({ params: [] });
    expect(PlaybookSchema.safeParse(p).success).toBe(false);
  });

  it('rejects an unknown expect primitive', () => {
    const p = basePlaybook();
    (p.steps as Record<string, unknown>[])[0] = {
      ...(p.steps as Record<string, unknown>[])[0],
      expect: { totally_made_up: true },
    };
    expect(PlaybookSchema.safeParse(p).success).toBe(false);
  });

  it('rejects a missing/empty verify block', () => {
    const p = basePlaybook({ verify: [] });
    expect(PlaybookSchema.safeParse(p).success).toBe(false);
  });

  it('rejects more than MAX_JUDGMENT_STEPS judgment steps', () => {
    const p = basePlaybook({
      params: [],
      steps: [
        { id: 'j1', kind: 'judgment', llm_judge: { prompt: 'a', options: ['x', 'y'] } },
        { id: 'j2', kind: 'judgment', llm_judge: { prompt: 'b', options: ['x', 'y'] } },
        { id: 'j3', kind: 'judgment', llm_judge: { prompt: 'c', options: ['x', 'y'] } },
      ],
      verify: [{ nonempty: true }],
    });
    expect(PlaybookSchema.safeParse(p).success).toBe(false);
  });

  it('accepts a slot step and a judgment step within the cap', () => {
    const p = basePlaybook();
    (p.steps as unknown[]).push(
      {
        id: 'summarize',
        kind: 'slot',
        llm_fill: { prompt: 'summarize {{amount}}', max_tokens: 100, into: 'notes' },
      } satisfies Step,
      {
        id: 'route',
        kind: 'judgment',
        llm_judge: { prompt: 'urgent?', options: ['yes', 'no'] },
      } satisfies Step,
    );
    expect(PlaybookSchema.safeParse(p).success).toBe(true);
  });

  it('reports multiple simultaneous semantic issues rather than stopping at the first', () => {
    // Both checks below live in the same superRefine pass (unlike a base
    // shape failure such as an empty `verify`, which short-circuits before
    // superRefine ever runs) — so both must appear together.
    const p = basePlaybook({ params: [] });
    (p.steps as Record<string, unknown>[])[1] = {
      ...(p.steps as Record<string, unknown>[])[1],
      id: 'open_portal', // duplicate id
    };
    const result = PlaybookSchema.safeParse(p);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' | ');
      expect(messages).toContain('Duplicate step id');
      expect(messages).toContain('Undeclared param');
    }
  });
});
