import { BrowserContextCoordinateSchema } from '@rote/browser';
import { z } from 'zod';

/** Parses immutable historical role/name/coarse-depth node identities. */
export const StableNodeIdV1Schema = z.object({ hash: z.string().length(16) }).strict();
/** Historical unversioned stable node identity. */
export type StableNodeIdV1 = z.infer<typeof StableNodeIdV1Schema>;

/** Parses context- and container-aware node identities emitted by new captures. */
export const StableNodeIdV2Schema = z.object({
  version: z.literal(2),
  hash: z.string().length(16),
  contextHash: z.string().length(16),
  containerHash: z.string().length(16),
}).strict();
/** Context- and container-aware stable node identity. */
export type StableNodeIdV2 = z.infer<typeof StableNodeIdV2Schema>;

// INVARIANT: historical v1 trajectory/playbook observations remain parseable and
// unchanged; new captures emit v2 rather than rewriting append-only artifacts.
/** Versioned durable node identity; accepts historical v1 and emits context-aware v2. */
export const StableNodeIdSchema = z.union([StableNodeIdV2Schema, StableNodeIdV1Schema]);
/** Any durable stable node identity accepted from append-only artifacts. */
export type StableNodeId = z.infer<typeof StableNodeIdSchema>;

/** Parses action-facing references while retaining unprefixed historical v1 references. */
export const StableNodeRefSchema = z.string().regex(/^(?:[0-9a-f]{16}|v2:[0-9a-f]{16})$/);
/** Version-preserving stable identity reference copied into actions and trajectories. */
export type StableNodeRef = z.infer<typeof StableNodeRefSchema>;

/** Converts a structured identity to its action-facing, version-preserving reference. */
export function stableNodeRef(id: StableNodeId): StableNodeRef {
  return StableNodeRefSchema.parse('version' in id ? `v2:${id.hash}` : id.hash);
}

/**
 * Observable behavioral facts of an interactive control, derived from the capture
 * without values (#143). Same-looking controls that differ here have a different
 * action contract: an `<input>` that became a `<textarea>` keeps its identity but
 * Enter no longer submits; a link that became a POST submit button keeps its name
 * but its destination and safety changed.
 */
export const NodeAffordanceSchema = z.object({
  control: z.enum([
    'single_line_text', 'multi_line_text', 'select_single', 'select_multiple',
    'checkbox', 'radio', 'button', 'submit', 'link', 'file', 'generic',
  ]),
  /** HTML input type for input controls (text, email, number, password, ...). */
  input_type: z.string().optional(),
  enter_behavior: z.enum(['submits_form', 'inserts_newline', 'none']),
  /** 16-hex digest of origin+pathname of the link href or enclosing form action; never query strings. */
  destination_hash: z.string().length(16).optional(),
  form_method: z.enum(['get', 'post', 'dialog']).optional(),
  enabled: z.boolean(),
  draggable: z.boolean(),
});
export type NodeAffordance = z.infer<typeof NodeAffordanceSchema>;

export const DistilledNodeSchema = z.object({
  id: StableNodeIdSchema,
  role: z.string().min(1),
  name: z.string().default(''),
  tag: z.string().min(1),
  selectorHint: z.string().optional(),
  depth: z.number().int().nonnegative(),
  interactive: z.boolean(),
  context: BrowserContextCoordinateSchema.optional(),
  state: z.object({ checked: z.boolean().optional() }).optional(),
  /** Present for interactive nodes; see `NodeAffordanceSchema`. */
  affordance: NodeAffordanceSchema.optional(),
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
