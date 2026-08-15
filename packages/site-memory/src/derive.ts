import { z } from 'zod';
import {
  ActionContractSchema,
  TrajectoryEventSchema,
  type FormSemanticsRecord,
  type PageEdgeRecord,
  type QuirkRecord,
  type SelectorMapRecord,
  type SiteMemoryRecord,
} from '@rote/core';

// see docs/02-architecture.md "Tiers 1 and 2 — the learning plane" — derivation
// is pure: one recorded run in, value-free advisory records out. It reads only
// what the agent recorder already redacts (resolution, action contract, page-key
// digests) and never a dispatched value, URL, or observation.

const Hex16 = /^[0-9a-f]{16}$/;

/** The recorded per-step result fields site memory reads (subset; everything else is ignored). */
export const SiteMemoryStepResultSchema = z.object({
  post_action_evidence: z.object({ passed: z.boolean() }).passthrough().optional(),
  resolution: z.object({
    selector: z.string().min(1),
    strategy: z.string().min(1),
    stableId: z.string().optional(),
    context: z.object({ contextHash: z.string(), path: z.array(z.unknown()) }).passthrough().optional(),
  }).passthrough().optional(),
  action_contract: ActionContractSchema.optional(),
  page_key: z.string().regex(Hex16).optional(),
  next_page_key: z.string().regex(Hex16).optional(),
}).passthrough();

export const SiteMemoryEventSchema = z.object({ event: TrajectoryEventSchema, result: z.unknown() });
export type SiteMemoryEvent = z.infer<typeof SiteMemoryEventSchema>;

export interface DeriveSiteMemoryOptions {
  /** Partition and hard gate: the run's `EnvFingerprint.fingerprint_hash`. */
  fingerprintHash: string;
  runId: string;
  /** Observation timestamp for every record (ISO); injected — derivation reads no clock. */
  observedAt: string;
}

export interface DeriveSiteMemoryReport {
  records: SiteMemoryRecord[];
  /** Events that contributed nothing and why — derivation is visible, never silent. */
  skipped: Array<{ seq: number; reason: 'not_dispatched' | 'no_page_key' | 'no_identity' | 'terminal_done' | 'unsupported_tool' }>;
}

const ELEMENT_TOOLS = new Set(['browser.fill', 'browser.select', 'browser.click', 'browser.hover', 'browser.press', 'browser.upload', 'browser.dragAndDrop']);
type EdgeKind = PageEdgeRecord['action_kind'];

/**
 * Derives site memory from one recorded run:
 * - `selector_map` for every dispatched element step with a stable identity (how it
 *   resolved on that page);
 * - `page_edge` for every dispatched step whose settled page differs from the page
 *   it acted on;
 * - `form_semantics` per page from the fill/select contracts plus the submit click's
 *   destination/method/safety;
 * - `quirk` records for contract facts worth knowing (`enter_inserts_newline`,
 *   `submit_is_mutating`).
 * Confidence is 1 for directly observed facts; consolidation applies freshness.
 */
export function deriveSiteMemory(events: readonly SiteMemoryEvent[], options: DeriveSiteMemoryOptions): DeriveSiteMemoryReport {
  const parsed = events.map((entry) => SiteMemoryEventSchema.parse(entry)).sort((a, b) => a.event.seq - b.event.seq);
  const records: SiteMemoryRecord[] = [];
  const skipped: DeriveSiteMemoryReport['skipped'] = [];
  const forms = new Map<string, { fields: FormSemanticsRecord['fields']; submit?: { destination_hash?: string; method?: FormSemanticsRecord['method']; safety?: FormSemanticsRecord['safety'] } }>();
  const common = (seq: number, kind: string) => ({
    version: 1 as const,
    record_id: `${options.runId}:${seq}:${kind}`,
    fingerprint_hash: options.fingerprintHash,
    observed_at: options.observedAt,
    run_id: options.runId,
    source: 'observed' as const,
    confidence: 1,
  });

  for (const { event, result } of parsed) {
    if (event.tool === 'browser.done') { skipped.push({ seq: event.seq, reason: 'terminal_done' }); continue; }
    if (event.tool !== 'browser.navigate' && !ELEMENT_TOOLS.has(event.tool)) { skipped.push({ seq: event.seq, reason: 'unsupported_tool' }); continue; }
    const step = SiteMemoryStepResultSchema.safeParse(result ?? {});
    if (!step.success || !step.data.post_action_evidence) { skipped.push({ seq: event.seq, reason: 'not_dispatched' }); continue; }
    const { page_key: pageKey, next_page_key: nextPageKey, resolution, action_contract: contract } = step.data;
    if (!pageKey) { skipped.push({ seq: event.seq, reason: 'no_page_key' }); continue; }
    const kind = event.tool.replace(/^browser\./, '') as EdgeKind;
    const stableId = resolution?.stableId ?? (typeof event.args['stableId'] === 'string' ? event.args['stableId'] : undefined);
    const role = contract?.target.role ?? (typeof event.args['role'] === 'string' ? event.args['role'] : undefined);
    const name = contract?.target.name ?? (typeof event.args['name'] === 'string' ? event.args['name'] : undefined);

    if (nextPageKey && nextPageKey !== pageKey) {
      records.push({
        ...common(event.seq, 'page_edge'), kind: 'page_edge', from_page_key: pageKey, to_page_key: nextPageKey, action_kind: kind,
        ...(kind !== 'navigate' && stableId ? { stable_id: stableId } : {}),
        ...(kind !== 'navigate' && role ? { role } : {}),
        ...(kind !== 'navigate' && name ? { name } : {}),
      });
    }
    if (kind === 'navigate') continue;
    if (!stableId || !role) { skipped.push({ seq: event.seq, reason: 'no_identity' }); continue; }
    if (resolution) {
      const selectorMap: SelectorMapRecord = {
        ...common(event.seq, 'selector_map'), kind: 'selector_map', page_key: pageKey, stable_id: stableId, role,
        ...(name ? { name } : {}), selector: resolution.selector, strategy: resolution.strategy,
        ...(resolution.context?.path.length && Hex16.test(resolution.context.contextHash) ? { context_hash: resolution.context.contextHash } : {}),
      };
      records.push(selectorMap);
    }
    if (contract) {
      const form = forms.get(pageKey) ?? { fields: [] };
      if (kind === 'fill' || kind === 'select') {
        form.fields.push({ stable_id: stableId, role, ...(name ? { name } : {}), affordance: contract.affordance });
        if (contract.affordance.enter_behavior === 'inserts_newline') {
          const quirk: QuirkRecord = { ...common(event.seq, 'quirk'), kind: 'quirk', page_key: pageKey, code: 'enter_inserts_newline', stable_id: stableId };
          records.push(quirk);
        }
      } else if (kind === 'click' && contract.affordance.control === 'submit') {
        form.submit = {
          ...(contract.affordance.destination_hash ? { destination_hash: contract.affordance.destination_hash } : {}),
          ...(contract.affordance.form_method ? { method: contract.affordance.form_method } : {}),
          safety: contract.safety,
        };
        if (contract.safety === 'mutating') {
          const quirk: QuirkRecord = { ...common(event.seq, 'quirk'), kind: 'quirk', page_key: pageKey, code: 'submit_is_mutating', stable_id: stableId };
          records.push(quirk);
        }
      }
      forms.set(pageKey, form);
    }
  }

  let formSeq = 0;
  for (const [pageKey, form] of forms) {
    if (form.fields.length === 0) continue;
    const record: FormSemanticsRecord = {
      ...common(-1 - formSeq, 'form_semantics'), kind: 'form_semantics', page_key: pageKey, fields: form.fields,
      ...(form.submit?.destination_hash ? { destination_hash: form.submit.destination_hash } : {}),
      ...(form.submit?.method ? { method: form.submit.method } : {}),
      ...(form.submit?.safety ? { safety: form.submit.safety } : {}),
    };
    records.push(record);
    formSeq += 1;
  }
  return { records, skipped };
}
