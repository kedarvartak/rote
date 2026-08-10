import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseEnterpriseContractProtocol } from '../../src/enterprise-contract.js';

const protocolPath = fileURLToPath(new URL('../../../../scripts/bench/enterprise/protocol.json', import.meta.url));

describe('enterprise oracle invariant', () => {
  it('never treats harness conclusion, DOM churn, stale evidence, or other-task evidence as success', async () => {
    const protocol = parseEnterpriseContractProtocol(JSON.parse(await readFile(protocolPath, 'utf8')));

    expect(new Set(protocol.prohibited_success_signals)).toEqual(new Set([
      'harness_conclusion',
      'generic_dom_change',
      'stale_evidence',
      'other_task_evidence',
    ]));
    for (const contract of protocol.cases) {
      if (!contract.positive) {
        expect(contract.oracle).toEqual(expect.objectContaining({ kind: 'typed_failure', dispatch_count: 0 }));
        continue;
      }
      expect(contract.oracle.kind).not.toBe('typed_failure');
      if (contract.oracle.kind === 'server_state') {
        expect(contract.oracle.task_id).toMatch(/-contract$/);
        expect(contract.oracle.expected_events.every((event) => event.payload_sha256 !== undefined)).toBe(true);
      } else {
        expect(contract.oracle).toEqual(expect.objectContaining({
          kind: 'browser_download_event',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }));
      }
    }
  });
});
