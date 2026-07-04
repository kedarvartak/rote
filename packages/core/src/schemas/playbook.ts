import { z } from 'zod';
import { ExpectSchema } from './expect.js';
import { EnvFingerprintPatternSchema } from './env-fingerprint.js';
import { extractParamRefs } from '../template.js';

export const ParamTypeSchema = z.enum(['string', 'number', 'boolean', 'money']);
export type ParamType = z.infer<typeof ParamTypeSchema>;

export const ParamSchema = z.object({
  name: z.string().min(1),
  type: ParamTypeSchema,
});
export type Param = z.infer<typeof ParamSchema>;

export const OnFailSchema = z.enum(['retry', 'repair', 'fallback']);
export type OnFail = z.infer<typeof OnFailSchema>;

const stepBaseShape = {
  id: z.string().min(1),
  depends_on: z.array(z.string()).default([]),
  expect: ExpectSchema.optional(),
  on_fail: OnFailSchema.default('fallback'),
};

/** Zero LLM tokens: dispatches a tool call directly with bound args. */
export const DeterministicStepSchema = z.object({
  ...stepBaseShape,
  kind: z.literal('deterministic'),
  tool: z.string().min(1),
  args: z.record(z.string(), z.unknown()).default({}),
});
export type DeterministicStep = z.infer<typeof DeterministicStepSchema>;

/** A scoped, cheap LLM call that fills a content value — never control flow. */
export const SlotStepSchema = z.object({
  ...stepBaseShape,
  kind: z.literal('slot'),
  llm_fill: z.object({
    prompt: z.string().min(1),
    max_tokens: z.number().int().positive(),
    into: z.string().min(1),
  }),
});
export type SlotStep = z.infer<typeof SlotStepSchema>;

/** A rare, constrained branch: a classification over a closed set of options. */
export const JudgmentStepSchema = z.object({
  ...stepBaseShape,
  kind: z.literal('judgment'),
  llm_judge: z.object({
    prompt: z.string().min(1),
    options: z.array(z.string().min(1)).min(2),
  }),
});
export type JudgmentStep = z.infer<typeof JudgmentStepSchema>;

export const StepSchema = z.discriminatedUnion('kind', [
  DeterministicStepSchema,
  SlotStepSchema,
  JudgmentStepSchema,
]);
export type Step = z.infer<typeof StepSchema>;

/**
 * Hard cap on judgment steps per playbook (docs/02-architecture.md
 * "Open questions" #2). A task needing more branching than this is not
 * memoized — it stays a plain agent task rather than becoming a
 * badly-authored workflow engine.
 */
export const MAX_JUDGMENT_STEPS = 2;

const PlaybookShapeSchema = z.object({
  playbook: z.string().min(1),
  version: z.number().int().positive(),
  task_signature: z.object({
    intent_description: z.string().min(1),
    env_fingerprint: EnvFingerprintPatternSchema,
  }),
  params: z.array(ParamSchema).default([]),
  steps: z.array(StepSchema).min(1),
  verify: z.array(ExpectSchema).min(1),
  confidence: z.number().min(0).max(1).default(1),
});
export type Playbook = z.infer<typeof PlaybookShapeSchema>;

/**
 * Full playbook validation: structural shape (above) plus the semantic
 * invariants that make a playbook safe to compile and replay — see
 * docs/06-build-plan.md M0 "Rejection" tests.
 */
export const PlaybookSchema = PlaybookShapeSchema.superRefine((playbook, ctx) => {
  const seenIds = new Set<string>();
  for (const step of playbook.steps) {
    if (seenIds.has(step.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate step id "${step.id}"`,
        path: ['steps'],
      });
    }
    seenIds.add(step.id);
  }

  for (const step of playbook.steps) {
    for (const dep of step.depends_on) {
      if (!seenIds.has(dep)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Step "${step.id}" depends_on unknown step "${dep}"`,
          path: ['steps'],
        });
      }
    }
  }

  const cycle = findDependencyCycle(playbook.steps);
  if (cycle) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Cyclic depends_on: ${cycle.join(' -> ')}`,
      path: ['steps'],
    });
  }

  const judgmentCount = playbook.steps.filter((s) => s.kind === 'judgment').length;
  if (judgmentCount > MAX_JUDGMENT_STEPS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Too many judgment steps (${judgmentCount} > ${MAX_JUDGMENT_STEPS}); task is unmemoizable as-is`,
      path: ['steps'],
    });
  }

  // A {{name}} reference is valid if it's a caller-supplied param OR a
  // binding a step *produces* at replay time: a slot step's `llm_fill.into`
  // or a judgment step's own id (its classification result) — see the
  // executor (M2) for how those get bound. Both are legitimate template
  // sources; only a name matching neither is genuinely undeclared.
  const declaredParams = new Set(playbook.params.map((p) => p.name));
  const computedBindings = new Set(
    playbook.steps.flatMap((step) => {
      if (step.kind === 'slot') return [step.llm_fill.into];
      if (step.kind === 'judgment') return [step.id];
      return [];
    }),
  );
  const referenced = new Set([
    ...extractParamRefs(playbook.steps),
    ...extractParamRefs(playbook.verify),
  ]);
  for (const name of referenced) {
    if (!declaredParams.has(name) && !computedBindings.has(name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Undeclared param "{{${name}}}" referenced in playbook`,
        path: ['params'],
      });
    }
  }
});

function findDependencyCycle(
  steps: readonly { id: string; depends_on: readonly string[] }[],
): string[] | null {
  const graph = new Map(steps.map((s) => [s.id, s.depends_on] as const));
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  function visit(id: string): string[] | null {
    state.set(id, 'visiting');
    stack.push(id);
    for (const dep of graph.get(id) ?? []) {
      const depState = state.get(dep);
      if (depState === 'visiting') {
        const cycleStart = stack.indexOf(dep);
        return [...stack.slice(cycleStart), dep];
      }
      if (depState !== 'done') {
        const found = visit(dep);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(id, 'done');
    return null;
  }

  for (const id of graph.keys()) {
    if (!state.has(id)) {
      const found = visit(id);
      if (found) return found;
    }
  }
  return null;
}
