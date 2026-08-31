import { z } from 'zod';

// see docs/03-benchmark.md "Generalization (V2)" — measurement rows and their
// stop rules are frozen before provider-billed collection begins.

const UsageBucketSchema = z.enum([
  'input_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'output_tokens',
]);
const SourceTagSchema = z.enum([
  'planner',
  'matcher',
  'slot',
  'judgment',
  'repair',
  'verify',
  'distill',
  'route',
  'predict',
]);
const OracleKindSchema = z.enum([
  'fixture_oracle',
  'api_state',
  'database_state',
  'browser_download_event',
]);

/** A provider-billed P2 measurement gate. */
export const P2CampaignGateSchema = z.enum(['t0', 't2', 'routing', 'b4']);
/** One of the P2 exit measurements. */
export type P2CampaignGate = z.infer<typeof P2CampaignGateSchema>;

const CampaignCellSchema = z.object({
  id: z.string().min(1),
  gate: P2CampaignGateSchema,
  task_description: z.string().min(1),
  baseline_description: z.string().min(1),
  reset_command: z.string().min(1),
  oracle: z.object({
    kind: OracleKindSchema,
    command: z.string().min(1),
    task_bound: z.literal(true),
  }).strict(),
  required_source_tags: z.array(SourceTagSchema).min(1),
  minimum_transitions: z.number().int().positive().default(1),
}).strict();

/**
 * Immutable collection contract for the provider-billed P2 exit campaign.
 *
 * Paths name output locations only; credentials and raw dispatched values are
 * deliberately absent so protocol commits cannot leak them.
 */
export const P2CampaignProtocolSchema = z.object({
  schema_version: z.literal(1),
  protocol_id: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  repetitions_per_cell: z.number().int().min(15),
  seed_policy: z.string().min(1),
  pricing_table: z.string().min(1),
  artifacts: z.object({
    raw_jsonl: z.string().min(1),
    manifests_directory: z.string().min(1),
    receipts_directory: z.string().min(1),
    report_directory: z.string().min(1),
  }).strict(),
  gates: z.object({
    t0_min_reduction: z.literal(0.8),
    t2_min_reduction: z.literal(0.3),
    t2_retreat_below: z.literal(0.15),
    routing_min_warm_steps_off_frontier: z.literal(0.5),
  }).strict(),
  cells: z.array(CampaignCellSchema).length(4),
}).strict().superRefine((protocol, context) => {
  const ids = new Set<string>();
  const gates = new Set<P2CampaignGate>();
  for (const [index, cell] of protocol.cells.entries()) {
    if (ids.has(cell.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['cells', index, 'id'], message: 'campaign cell ids must be unique' });
    }
    ids.add(cell.id);
    if (gates.has(cell.gate)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['cells', index, 'gate'], message: 'each campaign gate must have exactly one cell' });
    }
    gates.add(cell.gate);
    if (cell.gate === 'b4' && cell.minimum_transitions < 50) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['cells', index, 'minimum_transitions'], message: 'B4 requires at least 50 transitions' });
    }
    if (cell.gate === 'routing' && !cell.required_source_tags.includes('route')) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['cells', index, 'required_source_tags'], message: 'routing requires route telemetry' });
    }
    if (cell.gate === 'routing' && !cell.required_source_tags.includes('predict')) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['cells', index, 'required_source_tags'], message: 'routing requires predict telemetry' });
    }
    if (cell.gate === 't0' && (!cell.required_source_tags.includes('distill') || !cell.required_source_tags.includes('matcher'))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['cells', index, 'required_source_tags'], message: 'T0 requires distill and matcher telemetry' });
    }
  }
  for (const gate of P2CampaignGateSchema.options) {
    if (!gates.has(gate)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['cells'], message: `campaign is missing ${gate} measurement` });
    }
  }
});
/** Immutable provider-billed P2 collection contract. */
export type P2CampaignProtocol = z.infer<typeof P2CampaignProtocolSchema>;

/** One no-provider row proving that a campaign cell is collectable. */
export const P2CampaignDryRunRowSchema = z.object({
  cell_id: z.string().min(1),
  usage_buckets: z.array(UsageBucketSchema),
  source_tags: z.array(SourceTagSchema),
  pricing_table_loaded: z.boolean(),
  reset_evidence: z.object({ command: z.string().min(1), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  oracle_evidence: z.object({
    kind: OracleKindSchema,
    command: z.string().min(1),
    task_bound: z.literal(true),
  }).strict(),
}).strict();
/** No-provider preflight evidence for one planned campaign row. */
export type P2CampaignDryRunRow = z.infer<typeof P2CampaignDryRunRowSchema>;

/** Typed reason the preflight refused a campaign before provider billing begins. */
export const P2CampaignPreflightFailureSchema = z.enum([
  'campaign_row_missing',
  'campaign_row_duplicate',
  'usage_bucket_missing',
  'source_tag_missing',
  'pricing_unavailable',
  'reset_evidence_mismatch',
  'oracle_evidence_mismatch',
]);
/** Failure classification for a provider-billing preflight. */
export type P2CampaignPreflightFailure = z.infer<typeof P2CampaignPreflightFailureSchema>;

/** Fails closed with the cell that made a campaign unsafe to start. */
export class P2CampaignPreflightError extends Error {
  /** @param cellId Planned cell whose static evidence failed. */
  constructor(
    readonly classification: P2CampaignPreflightFailure,
    readonly cellId: string,
    detail: string,
  ) {
    super(`${classification} for ${cellId}: ${detail}`);
    this.name = 'P2CampaignPreflightError';
  }
}

const REQUIRED_USAGE_BUCKETS = new Set<z.infer<typeof UsageBucketSchema>>([
  'input_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'output_tokens',
]);

/**
 * Verifies no-provider campaign evidence for every frozen measurement cell.
 *
 * This is pure: callers supply parsed protocol and dry-run rows. It validates
 * collection readiness, not a provider result, so it cannot fabricate a pass.
 * @throws {@link P2CampaignPreflightError} if any row is incomplete or mismatched.
 */
export function assertP2CampaignPreflight(
  protocol: P2CampaignProtocol,
  rows: readonly P2CampaignDryRunRow[],
): void {
  const byCell = new Map<string, P2CampaignDryRunRow>();
  for (const row of rows) {
    if (byCell.has(row.cell_id)) {
      throw new P2CampaignPreflightError('campaign_row_duplicate', row.cell_id, 'dry-run evidence has more than one row');
    }
    byCell.set(row.cell_id, row);
  }

  for (const cell of protocol.cells) {
    const row = byCell.get(cell.id);
    if (!row) throw new P2CampaignPreflightError('campaign_row_missing', cell.id, 'dry-run evidence is absent');
    if (!row.pricing_table_loaded) {
      throw new P2CampaignPreflightError('pricing_unavailable', cell.id, 'the dated pricing table was not loaded');
    }
    for (const bucket of REQUIRED_USAGE_BUCKETS) {
      if (!row.usage_buckets.includes(bucket)) {
        throw new P2CampaignPreflightError('usage_bucket_missing', cell.id, `missing ${bucket}`);
      }
    }
    for (const source of cell.required_source_tags) {
      if (!row.source_tags.includes(source)) {
        throw new P2CampaignPreflightError('source_tag_missing', cell.id, `missing ${source}`);
      }
    }
    if (row.reset_evidence.command !== cell.reset_command) {
      throw new P2CampaignPreflightError('reset_evidence_mismatch', cell.id, 'reset command differs from protocol');
    }
    if (row.oracle_evidence.kind !== cell.oracle.kind
      || row.oracle_evidence.command !== cell.oracle.command
      || row.oracle_evidence.task_bound !== cell.oracle.task_bound) {
      throw new P2CampaignPreflightError('oracle_evidence_mismatch', cell.id, 'oracle evidence differs from protocol');
    }
  }
}

/** Parses a human-authored immutable P2 campaign protocol. */
export function parseP2CampaignProtocol(input: unknown): P2CampaignProtocol {
  return P2CampaignProtocolSchema.parse(input);
}

/** Parses no-provider dry-run evidence without dropping malformed rows. */
export function parseP2CampaignDryRun(input: unknown): P2CampaignDryRunRow[] {
  return z.array(P2CampaignDryRunRowSchema).parse(input);
}
