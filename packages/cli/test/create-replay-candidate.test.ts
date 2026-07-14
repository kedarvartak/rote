import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BrowserReplayCandidateSchema } from '@rote/core';
import { browserEnvironmentFingerprint, createReplayCandidate, main } from '../src/index.js';

let root: string | undefined;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe('createReplayCandidate', () => {
  it('writes a portable exact-fingerprint candidate without replacing existing versions', async () => {
    root = await mkdtemp(join(tmpdir(), 'rote-candidate-'));
    const playbookPath = resolve('../../fixtures/playbooks/browser-b1-stateful.yaml');
    const outPath = join(root, 'memory', 'b1-v1.json');

    const created = await createReplayCandidate({
      playbookPath,
      url: 'http://127.0.0.1:4321/b1-report.html',
      params: { username: 'analyst', password: 'secret' },
      outPath,
    });

    const saved = BrowserReplayCandidateSchema.parse(JSON.parse(await readFile(outPath, 'utf8')));
    expect(created.path).toBe(outPath);
    expect(resolve(join(root, 'memory'), saved.playbook_path)).toBe(playbookPath);
    expect(saved.fingerprint_hash).toBe(
      browserEnvironmentFingerprint(new URL('http://127.0.0.1:9999/other')).fingerprint_hash,
    );
    await expect(createReplayCandidate({
      playbookPath,
      url: 'http://127.0.0.1:4321/b1-report.html',
      params: { username: 'other', password: 'other' },
      outPath,
    })).rejects.toMatchObject({ code: 'EEXIST' });
  });

  it('rejects missing or mistyped declared bindings before writing', async () => {
    root = await mkdtemp(join(tmpdir(), 'rote-candidate-invalid-'));
    await expect(createReplayCandidate({
      playbookPath: resolve('../../fixtures/playbooks/browser-b1-stateful.yaml'),
      url: 'http://127.0.0.1:4321/b1-report.html',
      params: { username: 42, password: 'secret' },
      outPath: join(root, 'invalid.json'),
    })).rejects.toThrow('candidate param username must be string');
  });

  it('exposes candidate creation through the CLI', async () => {
    root = await mkdtemp(join(tmpdir(), 'rote-candidate-cli-'));
    const playbookPath = resolve('../../fixtures/playbooks/browser-b2-stateful.yaml');
    const outPath = join(root, 'b2-v1.json');

    const output = await main([
      'candidate', 'create', playbookPath,
      '--url', 'http://127.0.0.1:4321/b2-vendor-form.html',
      '--params', '{"company_name":"Acme","contact_email":"ops@example.com","country":"US"}',
      '--out', outPath,
    ]);

    expect(output).toContain(`wrote ${outPath}`);
    expect(BrowserReplayCandidateSchema.parse(JSON.parse(await readFile(outPath, 'utf8'))).params).toEqual({
      company_name: 'Acme', contact_email: 'ops@example.com', country: 'US',
    });
  });
});
