import { describe, expect, it } from 'vitest';
import { auditT0Campaign, type T0CampaignRecord } from '../src/index.js';
const tokens = { input_tokens: 100, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 10 };
function rows(): T0CampaignRecord[] { return Array.from({ length: 15 }, (_, i) => [
  { protocol_id: 'p2-provider-exit-campaign-v1', cell_id: 't0-distillation-repeat', repetition: i + 1, phase: 'cold' as const, agent_concluded: true, exact_authoritative_verification: true, usage: [{ source: 'planner' as const, tokens }, { source: 'verify' as const, tokens }], duration_ms: 1 },
  { protocol_id: 'p2-provider-exit-campaign-v1', cell_id: 't0-distillation-repeat', repetition: i + 1, phase: 'warm' as const, agent_concluded: true, exact_authoritative_verification: true, usage: [{ source: 'distill' as const, tokens }, { source: 'matcher' as const, tokens }, { source: 'verify' as const, tokens }], duration_ms: 1 },
]).flat(); }
describe('T0 campaign audit', () => {
  it('retains 15 matched exact-verification pairs and their tagged overhead', () => { expect(auditT0Campaign(rows())).toEqual(expect.objectContaining({ repetitions: 15, success_parity: true, gate_ready: true })); });
  it.each(['missing', 'duplicate', 'source'] as const)('fails closed on %s campaign evidence', (kind) => { const value = rows(); if (kind === 'missing') value.pop(); if (kind === 'duplicate') value.push(value[0]!); if (kind === 'source') value[1] = { ...value[1]!, usage: value[1]!.usage.filter((x) => x.source !== 'matcher') }; expect(() => auditT0Campaign(value)).toThrow(); });
});
