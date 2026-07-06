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
