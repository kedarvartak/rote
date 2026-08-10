import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseEnterpriseContractProtocol } from '../src/enterprise-contract.js';

const protocolPath = fileURLToPath(new URL('../../../scripts/bench/enterprise/protocol.json', import.meta.url));

async function frozenProtocol(): Promise<unknown> {
  return JSON.parse(await readFile(protocolPath, 'utf8'));
}

describe('enterprise contract corpus', () => {
  it('freezes every category, adversarial control, and separate lifecycle mode', async () => {
    const protocol = parseEnterpriseContractProtocol(await frozenProtocol());

    expect(protocol.cases).toHaveLength(19);
    expect(protocol.endurance).toEqual({
      single_session_transitions: 60,
      multi_session_restarts: 2,
      report_separately: true,
    });
    expect(protocol.claims_allowed).toEqual([]);
    expect(protocol.cases.filter((contract) => contract.mode === 'multi_session').map((contract) => contract.id)).toEqual([
      'E7-CONTINUATION-RESTART',
      'E7-CONTINUATION-MISMATCH',
    ]);
  });

  it('pins existing synthetic fixtures and the exact download bytes', async () => {
    const protocol = parseEnterpriseContractProtocol(await frozenProtocol());
    const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
    for (const contract of protocol.cases) await expect(access(`${repositoryRoot}${contract.fixture}`)).resolves.toBeUndefined();

    const download = await readFile(`${repositoryRoot}fixtures/enterprise/enterprise-report.txt`);
    expect(createHash('sha256').update(download).digest('hex')).toBe('3f4aa27417344a8f219a74176616ec004cadce4fdd7b0730beb0923019fd0cc4');
  });

  it('requires authoritative exact evidence for every positive case', async () => {
    const protocol = parseEnterpriseContractProtocol(await frozenProtocol());
    const positives = protocol.cases.filter((contract) => contract.positive);

    expect(positives.length).toBeGreaterThan(0);
    for (const contract of positives) {
      expect(contract.oracle.kind).not.toBe('typed_failure');
      if (contract.oracle.kind === 'server_state') {
        expect(contract.oracle.expected_events.length).toBeGreaterThan(0);
        for (const event of contract.oracle.expected_events) expect(event.payload_sha256).toMatch(/^[a-f0-9]{64}$/);
      }
    }
    expect(protocol.prohibited_success_signals).toEqual([
      'harness_conclusion',
      'generic_dom_change',
      'stale_evidence',
      'other_task_evidence',
    ]);
  });

  it('requires every negative control to stop before dispatch', async () => {
    const protocol = parseEnterpriseContractProtocol(await frozenProtocol());
    const negatives = protocol.cases.filter((contract) => !contract.positive);

    expect(negatives.length).toBeGreaterThan(0);
    for (const contract of negatives) {
      expect(contract.oracle).toEqual(expect.objectContaining({ kind: 'typed_failure', dispatch_count: 0 }));
    }
  });

  it('rejects a corpus that silently drops a required adversarial control', async () => {
    const input = await frozenProtocol() as { cases: Array<{ controls: string[] }> };
    for (const contract of input.cases) contract.controls = contract.controls.filter((control) => control !== 'unrelated_mutation');

    expect(() => parseEnterpriseContractProtocol(input)).toThrow(/missing failure control unrelated_mutation/);
  });

  it('rejects relabeling continuation as single-session endurance', async () => {
    const input = await frozenProtocol() as { cases: Array<{ id: string; mode: string; process_restarts: number }> };
    const continuation = input.cases.find((contract) => contract.id === 'E7-CONTINUATION-RESTART');
    if (!continuation) throw new Error('frozen continuation case missing');
    continuation.mode = 'single_session';

    expect(() => parseEnterpriseContractProtocol(input)).toThrow(/single-session cases cannot restart/);
  });
});
