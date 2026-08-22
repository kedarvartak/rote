import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FilePlaybookLibrary } from '@rote/matcher';
import { main } from '../src/index.js';

// `rote playbooks` lists the learned library value-free: names, versions,
// step counts, params, fingerprints — never recorded values.

const playbook = (name: string, version: number) => ({
  playbook: name,
  version,
  task_signature: {
    intent_description: 'Register vendor {{company_name}}',
    env_fingerprint: { domain: 'fixture.test', tool_prefixes: ['browser.'] },
  },
  params: [{ name: 'company_name', type: 'string' as const }],
  steps: [
    { id: 's1', tool: 'browser.navigate', args: { url: 'https://fixture.test/register' }, depends_on: [] },
    { id: 's2', tool: 'browser.fill', args: { selector: '#company-name', value: '{{company_name}}' }, depends_on: ['s1'] },
  ],
  verify: [{ text_visible: 'Vendor registration complete' }],
  confidence: 1,
});

describe('rote playbooks', () => {
  it('says the library is empty before any distill', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'rote-pb-'));
    expect(await main(['playbooks'], baseDir)).toContain('playbook library is empty');
  });

  it('lists each entry with version, step count, params, and truncated fingerprint', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'rote-pb-'));
    const library = new FilePlaybookLibrary(baseDir);
    await library.add({ playbook: playbook('b2-distilled', 1), fingerprintHash: 'a'.repeat(64), sourceRunId: 'run-1', addedAt: new Date('2026-08-22T00:00:00Z') });
    const out = await main(['playbooks'], baseDir);
    expect(out).toContain('b2-distilled v1 — 2 steps');
    expect(out).toContain('params: company_name');
    expect(out).toContain('aaaaaaaaaaaa…');
    expect(out).toContain('from run run-1');
    // value-free: no recorded value appears
    expect(out).not.toContain('Acme');
  });
});
