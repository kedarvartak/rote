import { z } from 'zod';

export const StableNodeIdSchema = z.object({ hash: z.string().length(16) });
export type StableNodeId = z.infer<typeof StableNodeIdSchema>;

export const DistilledNodeSchema = z.object({
  id: StableNodeIdSchema,
  role: z.string().min(1),
  name: z.string().default(''),
  tag: z.string().min(1),
  selectorHint: z.string().optional(),
  depth: z.number().int().nonnegative(),
  interactive: z.boolean(),
  state: z.object({ checked: z.boolean().optional() }).optional(),
});
export type DistilledNode = z.infer<typeof DistilledNodeSchema>;

export interface RenderOptions {
  maxChars?: number;
}

export interface RenderedObservation {
  text: string;
  truncated: boolean;
  approxTokens: number;
}

export const ObservationDiffSchema = z.object({
  added: z.array(DistilledNodeSchema),
  updated: z.array(DistilledNodeSchema),
  removed: z.array(z.string().length(16)),
  order: z.array(z.string().length(16)),
});
export type ObservationDiff = z.infer<typeof ObservationDiffSchema>;

export const AdaptiveObservationModeSchema = z.enum(['full', 'diff', 'summary', 'bootstrap']);
export type AdaptiveObservationMode = z.infer<typeof AdaptiveObservationModeSchema>;

export const AdaptiveRenderedObservationSchema = z.object({
  text: z.string(),
  truncated: z.boolean(),
  approxTokens: z.number().int().nonnegative(),
  mode: AdaptiveObservationModeSchema,
  diff: ObservationDiffSchema.optional(),
  bootstrap: z.object({
    budgetChars: z.number().int().nonnegative(),
    exceededByChars: z.number().int().positive(),
  }).optional(),
});
export type AdaptiveRenderedObservation = z.infer<typeof AdaptiveRenderedObservationSchema>;
