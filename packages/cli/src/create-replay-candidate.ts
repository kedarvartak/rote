import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { BrowserReplayCandidateSchema, parsePlaybookYaml, type BrowserReplayCandidate } from '@rote/core';
import { browserEnvironmentFingerprint } from './run-browser-task.js';

export interface CreateReplayCandidateOptions {
  playbookPath: string;
  url: string;
  params: Record<string, unknown>;
  outPath: string;
}

export interface CreatedReplayCandidate {
  path: string;
  candidate: BrowserReplayCandidate;
}

/** Validates a playbook and exclusively writes one exact-environment replay candidate. */
export async function createReplayCandidate(
  options: CreateReplayCandidateOptions,
): Promise<CreatedReplayCandidate> {
  const playbookPath = resolve(options.playbookPath);
  const playbook = parsePlaybookYaml(await readFile(playbookPath, 'utf8'));
  validateParams(playbook.params, options.params);
  const outPath = resolve(options.outPath);
  const fingerprint = browserEnvironmentFingerprint(new URL(options.url));
  const relativePlaybook = relative(dirname(outPath), playbookPath) || '.';
  const candidate = BrowserReplayCandidateSchema.parse({
    playbook_path: relativePlaybook,
    fingerprint_hash: fingerprint.fingerprint_hash,
    params: options.params,
  });
  await mkdir(dirname(outPath), { recursive: true });
  // INVARIANT: candidates are versioned artifacts; never overwrite an existing selection in place.
  await writeFile(outPath, `${JSON.stringify(candidate, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return { path: outPath, candidate };
}

function validateParams(
  declared: readonly { name: string; type: 'string' | 'number' | 'boolean' | 'money' }[],
  params: Record<string, unknown>,
): void {
  for (const param of declared) {
    if (param.name === 'base_url') continue; // rebound from the current --url after fingerprint gating
    const value = params[param.name];
    const valid = param.type === 'string'
      ? typeof value === 'string'
      : param.type === 'boolean'
        ? typeof value === 'boolean'
        : typeof value === 'number' && Number.isFinite(value);
    if (!valid) throw new Error(`candidate param ${param.name} must be ${param.type}`);
  }
}
