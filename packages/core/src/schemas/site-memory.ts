import { z } from 'zod';
import { sha256Hex } from '../fingerprint.js';
import { ActionContractAffordanceSchema, ActionContractSafetySchema } from './action-contract.js';

// see docs/02-architecture.md "Tiers 1 and 2 — the learning plane" — site memory
// is tier 2: per-fingerprint, append-only, *advisory* records of how a site behaves
// (selector maps, form semantics, page graph, settle priors, quirks). It informs;
// it never executes. Every record is value-free by construction: pages are 16-hex
// digests of origin+pathname, targets are stable identity refs / selectors, and no
// field can carry a typed value, credential, or query string.

const Hex16 = z.string().regex(/^[0-9a-f]{16}$/);
const StableIdRef = z.string().regex(/^v[0-9]+:[0-9a-f]{16}$/);

/** Digest key of a page: origin + pathname only — never query, fragment, or a raw URL. */
export function pageKey(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return sha256Hex(`${parsed.origin}${parsed.pathname}`).slice(0, 16);
  } catch {
    return undefined;
  }
}

const RecordCommon = {
  version: z.literal(1),
  record_id: z.string().min(1),
  /** Partition key and hard gate: `EnvFingerprint.fingerprint_hash` of the session that observed it (invariant 3). */
  fingerprint_hash: z.string().min(1),
  observed_at: z.string().datetime(),
  /** Run the observation came from — provenance for audit, never rewritten. */
  run_id: z.string().min(1),
  /** How the record was made: observed directly in a run, or derived from other records. */
  source: z.enum(['observed', 'derived']),
  /** Advisory confidence in [0, 1]; readers combine it with freshness. */
  confidence: z.number().min(0).max(1),
};

/** How a stable identity resolved on a page: the resolution hint replay/planning may try first. */
export const SelectorMapRecordSchema = z.object({
  ...RecordCommon,
  kind: z.literal('selector_map'),
  page_key: Hex16,
  stable_id: StableIdRef,
  role: z.string().min(1),
  name: z.string().optional(),
  /** Value-free CSS path / id selector that resolved; identity, not input. */
  selector: z.string().min(1),
  context_hash: Hex16.optional(),
  strategy: z.string().min(1),
}).strict();

/** Value-free semantics of one form on a page: which controls, and what submitting does. */
export const FormSemanticsRecordSchema = z.object({
  ...RecordCommon,
  kind: z.literal('form_semantics'),
  page_key: Hex16,
  /** Digest of origin+pathname the form submits to (from the submit control's contract). */
  destination_hash: Hex16.optional(),
  method: z.enum(['get', 'post', 'dialog']).optional(),
  safety: ActionContractSafetySchema.optional(),
  fields: z.array(z.object({
    stable_id: StableIdRef.optional(),
    role: z.string().min(1),
    name: z.string().optional(),
    affordance: ActionContractAffordanceSchema,
  }).strict()).min(1),
}).strict();

/** One observed edge of the page graph: acting on a control moved the session to another page. */
export const PageEdgeRecordSchema = z.object({
  ...RecordCommon,
  kind: z.literal('page_edge'),
  from_page_key: Hex16,
  to_page_key: Hex16,
  action_kind: z.enum(['navigate', 'click', 'press', 'select', 'fill', 'hover', 'upload', 'dragAndDrop']),
  /** Stable identity ref of the acted control; absent for `navigate` (its target is the page itself). */
  stable_id: StableIdRef.optional(),
  role: z.string().optional(),
  name: z.string().optional(),
}).strict();

/** Calibrated settle time for an action kind on a page (milliseconds). */
export const SettlePriorRecordSchema = z.object({
  ...RecordCommon,
  kind: z.literal('settle_prior'),
  page_key: Hex16,
  action_kind: z.string().min(1),
  samples: z.number().int().positive(),
  p50_ms: z.number().nonnegative(),
  p90_ms: z.number().nonnegative(),
  max_ms: z.number().nonnegative(),
}).strict();

/** A site behaviour worth knowing that is not identity: coded, never free text. */
export const QuirkRecordSchema = z.object({
  ...RecordCommon,
  kind: z.literal('quirk'),
  page_key: Hex16.optional(),
  /** Closed vocabulary so a brief can render it without carrying model- or page-authored text. */
  code: z.enum(['enter_inserts_newline', 'submit_is_mutating', 'form_requires_all_fields', 'route_changes_without_document', 'long_settle']),
  stable_id: StableIdRef.optional(),
}).strict();

export const SiteMemoryRecordSchema = z.discriminatedUnion('kind', [
  SelectorMapRecordSchema,
  FormSemanticsRecordSchema,
  PageEdgeRecordSchema,
  SettlePriorRecordSchema,
  QuirkRecordSchema,
]);
export type SiteMemoryRecord = z.infer<typeof SiteMemoryRecordSchema>;
export type SelectorMapRecord = z.infer<typeof SelectorMapRecordSchema>;
export type FormSemanticsRecord = z.infer<typeof FormSemanticsRecordSchema>;
export type PageEdgeRecord = z.infer<typeof PageEdgeRecordSchema>;
export type SettlePriorRecord = z.infer<typeof SettlePriorRecordSchema>;
export type QuirkRecord = z.infer<typeof QuirkRecordSchema>;
export type SiteMemoryRecordKind = SiteMemoryRecord['kind'];

/**
 * The identity a record asserts something about — records with the same key are
 * successive observations of one fact; the newest wins on read (append-only store,
 * consolidation on read).
 */
export function siteMemoryRecordKey(record: SiteMemoryRecord): string {
  switch (record.kind) {
    case 'selector_map': return `selector_map|${record.page_key}|${record.stable_id}`;
    case 'form_semantics': return `form_semantics|${record.page_key}|${record.destination_hash ?? '∅'}`;
    case 'page_edge': return `page_edge|${record.from_page_key}|${record.action_kind}|${record.stable_id ?? '∅'}`;
    case 'settle_prior': return `settle_prior|${record.page_key}|${record.action_kind}`;
    case 'quirk': return `quirk|${record.page_key ?? '∅'}|${record.code}|${record.stable_id ?? '∅'}`;
  }
}
