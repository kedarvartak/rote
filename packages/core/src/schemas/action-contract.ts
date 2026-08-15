import { z } from 'zod';
import { EvidenceClassSchema } from './verification-evidence.js';

// see docs/02-architecture.md "Structural action-contract drift" (#143) — a
// control can keep its identity while its behavioral contract changes. Reuse must
// classify that as `contract_mismatch` before dispatch instead of treating a
// successful target resolution as permission to act. Everything in this module is
// pure and value-free: no captured text, control values, credentials, or query
// strings ever enter a contract.

/** Verbs a contract can describe; mirrors the shared browser action union. */
export const ActionContractVerbSchema = z.enum(['navigate', 'fill', 'select', 'click', 'hover', 'press', 'upload', 'dragAndDrop']);
export type ActionContractVerb = z.infer<typeof ActionContractVerbSchema>;

/** Safety class of an action given its verb *and* its target's observable behavior. */
export const ActionContractSafetySchema = z.enum(['read', 'local_input', 'navigation', 'potentially_mutating', 'mutating']);
export type ActionContractSafety = z.infer<typeof ActionContractSafetySchema>;

/** Observable behavioral facts of the target control at contract time (value-free). */
export const ActionContractAffordanceSchema = z.object({
  control: z.enum([
    'single_line_text', 'multi_line_text', 'select_single', 'select_multiple',
    'checkbox', 'radio', 'button', 'submit', 'link', 'file', 'generic',
  ]),
  input_type: z.string().optional(),
  enter_behavior: z.enum(['submits_form', 'inserts_newline', 'none']),
  /** 16-hex digest of origin+pathname the control goes to (link href / form action). */
  destination_hash: z.string().length(16).optional(),
  form_method: z.enum(['get', 'post', 'dialog']).optional(),
  draggable: z.boolean(),
}).strict();

/** Deterministic pre-dispatch conditions observable in the capture. */
export const ActionContractPreconditionsSchema = z.object({
  visible: z.literal(true),
  enabled: z.boolean(),
}).strict();

/** Authoritative effect this step is expected to produce (a reference, never a payload). */
export const ActionContractEffectSchema = z.object({
  evidence_class: EvidenceClassSchema,
  /** Optional effect kind within that class, e.g. an oracle event kind. */
  kind: z.string().min(1).optional(),
}).strict();
export type ActionContractEffect = z.infer<typeof ActionContractEffectSchema>;

/**
 * Versioned action contract: identity/context, verb, affordance, safety, observable
 * preconditions, and required authoritative effect reference. Strict: unknown fields
 * (and therefore captured values) fail to parse.
 */
export const ActionContractSchema = z.object({
  version: z.literal(1),
  verb: ActionContractVerbSchema,
  target: z.object({
    role: z.string().min(1),
    /** Accessible name; identity, not a value. Empty for unnamed controls. */
    name: z.string(),
    stable_id: z.string().optional(),
    context_hash: z.string().length(16).optional(),
  }).strict(),
  affordance: ActionContractAffordanceSchema,
  safety: ActionContractSafetySchema,
  preconditions: ActionContractPreconditionsSchema,
  required_effect: ActionContractEffectSchema.optional(),
}).strict();
export type ActionContract = z.infer<typeof ActionContractSchema>;

/** Field families the compatibility matrix reasons about. */
export const ActionContractMismatchFieldSchema = z.enum([
  'version', 'verb', 'role', 'context', 'affordance', 'destination', 'safety', 'precondition', 'effect',
]);
export type ActionContractMismatchField = z.infer<typeof ActionContractMismatchFieldSchema>;

export interface ActionContractMismatch {
  field: ActionContractMismatchField;
  recorded: string;
  current: string;
}

/** Drift the matrix explicitly permits: identity survived, only these changed. */
export type ActionContractDrift = 'name' | 'stable_id';

export type ActionContractComparison =
  | { compatible: true; drift: ActionContractDrift[] }
  | { compatible: false; classification: 'contract_mismatch'; mismatches: ActionContractMismatch[] };

/**
 * Compatibility matrix (docs/02 "Structural action-contract drift").
 *
 * | Change | Verdict |
 * |---|---|
 * | selector, container/wrapper, cosmetic — not in the contract | compatible |
 * | accessible name or stable id (identity already re-resolved) | compatible, reported as drift |
 * | verb, role, browsing context | mismatch |
 * | affordance: control kind, input type, Enter behavior, draggable | mismatch |
 * | destination (link href / form action path, form method) | mismatch |
 * | safety class (either direction) | mismatch |
 * | precondition: enabled → disabled (or the reverse) | mismatch |
 * | required effect present on both sides and different | mismatch |
 *
 * `required_effect` is declared per step, not derivable from a capture, so an
 * absent current effect is not a mismatch; the effect gate itself is E7.4's.
 */
export function compareActionContracts(recorded: ActionContract, current: ActionContract): ActionContractComparison {
  const left = ActionContractSchema.parse(recorded);
  const right = ActionContractSchema.parse(current);
  const mismatches: ActionContractMismatch[] = [];
  const drift: ActionContractDrift[] = [];
  const differ = (field: ActionContractMismatchField, a: unknown, b: unknown) => {
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) mismatches.push({ field, recorded: String(a ?? '∅'), current: String(b ?? '∅') });
  };
  differ('version', left.version, right.version);
  differ('verb', left.verb, right.verb);
  differ('role', left.target.role, right.target.role);
  differ('context', left.target.context_hash, right.target.context_hash);
  if (left.target.name !== right.target.name) drift.push('name');
  if (left.target.stable_id !== right.target.stable_id) drift.push('stable_id');
  differ('affordance', left.affordance.control, right.affordance.control);
  differ('affordance', left.affordance.input_type, right.affordance.input_type);
  differ('affordance', left.affordance.enter_behavior, right.affordance.enter_behavior);
  differ('affordance', left.affordance.draggable, right.affordance.draggable);
  differ('destination', left.affordance.destination_hash, right.affordance.destination_hash);
  differ('destination', left.affordance.form_method, right.affordance.form_method);
  differ('safety', left.safety, right.safety);
  differ('precondition', left.preconditions.enabled, right.preconditions.enabled);
  if (left.required_effect && right.required_effect) differ('effect', left.required_effect, right.required_effect);
  return mismatches.length === 0
    ? { compatible: true, drift }
    : { compatible: false, classification: 'contract_mismatch', mismatches };
}
