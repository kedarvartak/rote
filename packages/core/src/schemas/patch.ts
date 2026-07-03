import { z } from 'zod';
import { StepSchema, PlaybookSchema, type Playbook } from './playbook.js';

export const PatchSchema = z.object({
  playbook: z.string().min(1),
  base_version: z.number().int().positive(),
  step_id: z.string().min(1),
  replacement_step: StepSchema,
  reason: z.string().min(1),
  created_by: z.enum(['repair', 'human']),
  run_id: z.string().min(1),
});
export type Patch = z.infer<typeof PatchSchema>;

export class UnknownStepError extends Error {
  constructor(public readonly stepId: string) {
    super(`Cannot apply patch: step "${stepId}" not found in playbook`);
    this.name = 'UnknownStepError';
  }
}

export class PlaybookMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(`Patch targets playbook "${expected}" but was applied to "${actual}"`);
    this.name = 'PlaybookMismatchError';
  }
}

/**
 * Applies a single-step patch to a playbook, producing a new, re-validated,
 * version-bumped playbook. Never mutates the input — playbooks are
 * append-only/versioned (docs/02-architecture.md invariant #4).
 */
export function applyPatch(playbook: Playbook, patch: Patch): Playbook {
  if (patch.playbook !== playbook.playbook) {
    throw new PlaybookMismatchError(patch.playbook, playbook.playbook);
  }
  const stepIndex = playbook.steps.findIndex((s) => s.id === patch.step_id);
  if (stepIndex === -1) {
    throw new UnknownStepError(patch.step_id);
  }
  const nextSteps = [...playbook.steps];
  nextSteps[stepIndex] = patch.replacement_step;
  const candidate = {
    ...playbook,
    steps: nextSteps,
    version: playbook.version + 1,
  };
  return PlaybookSchema.parse(candidate);
}
