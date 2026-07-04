import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  writeTrajectoryJsonl,
  parseTrajectoryJsonl,
  TrajectoryParseError,
} from '../src/serialize/trajectory-jsonl.js';
import { writePlaybookYaml, parsePlaybookYaml } from '../src/serialize/playbook-yaml.js';
import { PlaybookSchema } from '../src/schemas/playbook.js';
import type { TrajectoryEvent } from '../src/schemas/trajectory-event.js';

function sampleEvent(seq: number): TrajectoryEvent {
  return {
    run_id: 'run-1',
    seq,
    ts: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(),
    tool: 'browser.navigate',
    args: { url: `https://example.com/${seq}` },
    result_digest: { sha256: 'a'.repeat(64), byte_length: 10, preview: 'ok' },
    result_ref: { kind: 'inline', value: { ok: true } },
    duration_ms: 12,
  };
}

describe('trajectory JSONL round trip', () => {
  it('parses back exactly what was written', () => {
    const events = [sampleEvent(0), sampleEvent(1), sampleEvent(2)];
    const text = writeTrajectoryJsonl(events);
    expect(parseTrajectoryJsonl(text)).toEqual(events);
  });

  it('writes an empty string for zero events', () => {
    expect(writeTrajectoryJsonl([])).toBe('');
    expect(parseTrajectoryJsonl('')).toEqual([]);
  });

  it('tolerates a truncated trailing line by default (crash safety)', () => {
    const events = [sampleEvent(0), sampleEvent(1)];
    const text = `${writeTrajectoryJsonl(events)}{"run_id":"run-1","seq":2,"tool":"br`;
    expect(parseTrajectoryJsonl(text)).toEqual(events);
  });

  it('throws on a truncated trailing line when tolerance is disabled', () => {
    const text = `${writeTrajectoryJsonl([sampleEvent(0)])}{"broken`;
    expect(() => parseTrajectoryJsonl(text, { tolerateTrailingPartialLine: false })).toThrow(
      TrajectoryParseError,
    );
  });

  it('throws on a broken line that is not the last line, regardless of tolerance', () => {
    const text = `{"broken\n${writeTrajectoryJsonl([sampleEvent(0)])}`;
    expect(() => parseTrajectoryJsonl(text)).toThrow(TrajectoryParseError);
  });
});

const playbookFixture = {
  playbook: 'download-report',
  version: 1,
  task_signature: {
    intent_description: 'Log in and download the latest report',
    env_fingerprint: { domain: 'reports.acme.com', tool_prefixes: ['browser.'] },
  },
  params: [],
  steps: [
    {
      id: 'login',
      kind: 'deterministic' as const,
      tool: 'browser.navigate',
      args: { url: 'https://reports.acme.com/login' },
      expect: { selector_visible: '#dashboard' },
    },
  ],
  verify: [{ text_visible: 'Report downloaded' }],
};

describe('playbook YAML round trip', () => {
  it('parses back a semantically identical playbook', () => {
    const playbook = PlaybookSchema.parse(playbookFixture);
    const yaml = writePlaybookYaml(playbook);
    const reparsed = parsePlaybookYaml(yaml);
    expect(reparsed).toEqual(playbook);
  });

  it('rejects malformed YAML with a validation error', () => {
    const yaml = writePlaybookYaml(PlaybookSchema.parse(playbookFixture)).replace(
      'kind: deterministic',
      'kind: nonsense',
    );
    expect(() => parsePlaybookYaml(yaml)).toThrow();
  });

  it('parses the hand-authored fixture playbook', () => {
    const text = readFileSync(
      new URL('../../../fixtures/playbooks/b1-download-report.yaml', import.meta.url),
      'utf8',
    );
    const playbook = parsePlaybookYaml(text);
    expect(playbook.playbook).toBe('download-report');
    expect(playbook.steps.length).toBeGreaterThan(0);
  });
});
