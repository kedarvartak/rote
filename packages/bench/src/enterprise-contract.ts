import { z } from 'zod';

const EnterpriseCategorySchema = z.enum([
  'repeated_grid',
  'virtualized_grid',
  'same_origin_frame',
  'cross_origin_frame',
  'open_shadow_root',
  'closed_shadow_root',
  'complex_control',
  'authoritative_evidence',
  'spa_endurance',
  'multi_session_continuation',
]);

const EnterpriseControlSchema = z.enum([
  'exact_positive',
  'no_op',
  'unrelated_mutation',
  'identity_collision',
  'ambiguous_target',
  'stale_context',
  'stale_evidence',
  'task_mismatch',
  'closed_root',
  'restart_boundary',
]);

const ServerStateOracleSchema = z.object({
  kind: z.literal('server_state'),
  endpoint: z.string().min(1),
  task_id: z.string().regex(/^[a-z0-9-]+$/),
  expected_events: z.array(z.object({
    kind: z.string().min(1),
    target_key: z.string().min(1),
    payload_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })).min(1),
  expected_spa_transitions: z.number().int().nonnegative().optional(),
}).superRefine((oracle, context) => {
  const expectedEndpoint = `/api/oracle?task_id=${oracle.task_id}&generation={reset_generation}`;
  if (oracle.endpoint !== expectedEndpoint) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['endpoint'], message: `oracle endpoint must bind task and reset generation as ${expectedEndpoint}` });
  }
});

const DownloadOracleSchema = z.object({
  kind: z.literal('browser_download_event'),
  suggested_filename: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

const FailureOracleSchema = z.object({
  kind: z.literal('typed_failure'),
  classification: z.enum([
    'target_ambiguous',
    'browsing_context_stale',
    'closed_shadow_root_unsupported',
    'authoritative_effect_missing',
    'authoritative_evidence_stale',
    'authoritative_evidence_task_mismatch',
    'continuation_state_mismatch',
  ]),
  dispatch_count: z.literal(0),
});

const EnterpriseCaseSchema = z.object({
  id: z.string().regex(/^E7-[A-Z0-9-]+$/),
  category: EnterpriseCategorySchema,
  fixture: z.string().startsWith('fixtures/enterprise/'),
  task: z.string().min(1),
  mode: z.enum(['single_session', 'multi_session']),
  positive: z.boolean(),
  controls: z.array(EnterpriseControlSchema).min(1),
  required_capabilities: z.array(z.enum([
    'identity_v2',
    'iframe_traversal',
    'open_shadow_traversal',
    'authoritative_evidence',
    'hover',
    'keyboard',
    'upload',
    'drag_drop',
    'history_compaction',
    'continuation',
  ])).min(1),
  oracle: z.union([ServerStateOracleSchema, DownloadOracleSchema, FailureOracleSchema]),
  process_restarts: z.number().int().nonnegative(),
}).superRefine((contract, context) => {
  if (contract.positive === (contract.oracle.kind === 'typed_failure')) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['oracle'], message: 'positive cases require authoritative success evidence; negative cases require typed failure' });
  }
  if (contract.mode === 'single_session' && contract.process_restarts !== 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['process_restarts'], message: 'single-session cases cannot restart the browser process' });
  }
  if (contract.mode === 'multi_session' && contract.process_restarts < 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['process_restarts'], message: 'multi-session cases require at least one restart' });
  }
});

// see docs/02-architecture.md "Enterprise browser contracts" — tests and oracles
// precede identity, traversal, actions, continuation, and learned artifacts.
/** Frozen E7.1 fixture and oracle protocol; it specifies tests without implementing browser mechanisms. */
export const EnterpriseContractProtocolSchema = z.object({
  schema_version: z.literal(1),
  protocol_id: z.literal('p2-enterprise-contract-corpus-v1'),
  corpus_version: z.literal('e7.1-v1'),
  record_kind: z.literal('qualification_fixture'),
  synthetic_data_only: z.literal(true),
  initial_state: z.object({
    reset_method: z.literal('POST'),
    reset_endpoint: z.literal('/api/reset'),
    reset_before_each_case: z.literal(true),
    event_count: z.literal(0),
    spa_transition_count: z.literal(0),
  }),
  viewport: z.object({ width_css_px: z.number().int().positive(), height_css_px: z.number().int().positive() }),
  endurance: z.object({
    single_session_transitions: z.number().int().min(50),
    multi_session_restarts: z.number().int().min(1),
    report_separately: z.literal(true),
  }),
  prohibited_success_signals: z.array(z.enum(['harness_conclusion', 'generic_dom_change', 'stale_evidence', 'other_task_evidence'])).length(4),
  claims_allowed: z.array(z.never()).length(0),
  cases: z.array(EnterpriseCaseSchema).min(12),
}).superRefine((protocol, context) => {
  const ids = new Set<string>();
  const categories = new Set<string>();
  const controls = new Set<string>();
  for (const [index, contract] of protocol.cases.entries()) {
    if (ids.has(contract.id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['cases', index, 'id'], message: 'case ids must be unique' });
    ids.add(contract.id);
    categories.add(contract.category);
    contract.controls.forEach((control) => controls.add(control));
  }
  for (const category of EnterpriseCategorySchema.options) {
    if (!categories.has(category)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['cases'], message: `missing category ${category}` });
  }
  for (const control of EnterpriseControlSchema.options) {
    if (!controls.has(control)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['cases'], message: `missing failure control ${control}` });
  }
  const spa = protocol.cases.find((contract) => contract.category === 'spa_endurance' && contract.mode === 'single_session' && contract.positive);
  if (!spa || spa.oracle.kind !== 'server_state' || spa.oracle.expected_spa_transitions !== protocol.endurance.single_session_transitions
    || spa.oracle.expected_events.length !== protocol.endurance.single_session_transitions) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['cases'], message: 'single-session SPA events must exactly match the endurance transition count' });
  }
  const continuation = protocol.cases.find((contract) => contract.category === 'multi_session_continuation' && contract.mode === 'multi_session' && contract.positive);
  if (!continuation || continuation.process_restarts !== protocol.endurance.multi_session_restarts) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['cases'], message: 'continuation restarts must exactly match the separately reported lifecycle count' });
  }
});

/** Validated E7.1 corpus protocol derived from its Zod schema. */
export type EnterpriseContractProtocol = z.infer<typeof EnterpriseContractProtocolSchema>;
/** One positive or fail-closed case in the frozen enterprise corpus. */
export type EnterpriseContractCase = z.infer<typeof EnterpriseCaseSchema>;

/** Parses the frozen enterprise corpus and rejects omitted adversarial categories or controls. */
export function parseEnterpriseContractProtocol(input: unknown): EnterpriseContractProtocol {
  return EnterpriseContractProtocolSchema.parse(input);
}
