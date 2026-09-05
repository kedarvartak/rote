import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  parseTrajectoryJsonl,
  TrajectoryParseError,
  writeTrajectoryJsonl,
} from '../src/serialize/trajectory-jsonl.js';
import { parsePlaybookYaml, writePlaybookYaml } from '../src/serialize/playbook-yaml.js';
import { PlaybookSchema, type Playbook } from '../src/schemas/playbook.js';
import type { TrajectoryEvent } from '../src/schemas/trajectory-event.js';

// CLAUDE.md "Testing": property-based tests for serializers. A serializer is
// where hand-picked examples are least convincing — the values that break one
// are the ones nobody thought to write down (a newline inside a string, a
// value YAML would read back as a boolean, an empty record).

/** Strings chosen to be hostile to *both* formats, not merely non-empty. */
const hostileString = fc.oneof(
  fc.string({ minLength: 1 }),
  fc.constantFrom(
    'yes', 'no', 'null', '~', 'on', 'off', 'true', 'false',   // YAML would read these as scalars
    '1.0', '007', '0x10', '1e3', 'NaN', 'Infinity',            // ...and these as numbers
    '2026-01-01', '12:30:00',                                  // ...and these as timestamps
    ' leading', 'trailing ', '\t tab', '\n', 'a\nb\r\nc',      // whitespace the writer must preserve
    '#comment', ': colon', '- dash', '*anchor', '&anchor', '!!str', '|block', '>fold',
    '{}', '[]', '"quoted"', "'single'", '\\backslash', '{{param}}',
    'é😀🙈', '日本語',
  ),
);

const trajectoryEvent = (seq: number): fc.Arbitrary<TrajectoryEvent> => fc.record({
  run_id: hostileString,
  seq: fc.constant(seq),
  ts: fc.date({ min: new Date(0), max: new Date(4102444800000), noInvalidDate: true }).map((d) => d.toISOString()),
  tool: hostileString,
  // `__proto__` is excluded: Zod rebuilds a record by assignment, so that one
  // key is silently dropped on parse — a real round-trip violation, filed
  // separately as #208 rather than folded into this suite's concern.
  args: fc.dictionary(
    hostileString.filter((key) => key !== '__proto__'),
    fc.oneof(hostileString, fc.integer(), fc.boolean()),
  ),
  result_digest: fc.record({
    sha256: fc.hexaString({ minLength: 64, maxLength: 64 }),
    byte_length: fc.nat(),
    preview: fc.string(),
  }),
  result_ref: fc.oneof(
    fc.record({ kind: fc.constant('inline' as const), value: fc.oneof(hostileString, fc.integer(), fc.boolean()) }),
    fc.record({ kind: fc.constant('blob' as const), path: hostileString }),
  ),
  duration_ms: fc.nat(),
});

describe('trajectory JSONL serializer properties', () => {
  it('parses back exactly what was written, for any event sequence', () => {
    fc.assert(fc.property(
      fc.array(fc.nat({ max: 40 }), { minLength: 1, maxLength: 8 }).chain((seqs) =>
        fc.tuple(...seqs.map((seq) => trajectoryEvent(seq)))),
      (events) => {
        expect(parseTrajectoryJsonl(writeTrajectoryJsonl(events))).toEqual(events);
      },
    ));
  });

  it('writes exactly one line per event, so a torn write can only ever lose the last one', () => {
    fc.assert(fc.property(
      fc.array(trajectoryEvent(0), { minLength: 1, maxLength: 6 }),
      (events) => {
        const text = writeTrajectoryJsonl(events);
        expect(text.endsWith('\n')).toBe(true);
        expect(text.split('\n').filter((line) => line.length > 0)).toHaveLength(events.length);
      },
    ));
  });

  it('recovers a prefix of the run from a crash at any byte, never a gap and never a partial event', () => {
    // Truncating the text at an arbitrary byte models a process killed
    // mid-append. Two things must hold: what comes back is a *prefix* of what
    // was written (never a hole in the middle, never an invented event), and
    // every event whose line was fully flushed — its newline included — is
    // still there. The parser may additionally recover a final line that
    // happens to be complete JSON without its newline, which is a bonus, not
    // a requirement.
    fc.assert(fc.property(
      fc.array(trajectoryEvent(0), { minLength: 2, maxLength: 5 }),
      fc.nat(),
      (events, cut) => {
        const text = writeTrajectoryJsonl(events);
        const truncated = text.slice(0, cut % text.length);
        const flushedLines = truncated.split('\n').length - 1;
        const recovered = parseTrajectoryJsonl(truncated);
        expect(recovered).toEqual(events.slice(0, recovered.length));
        expect(recovered.length).toBeGreaterThanOrEqual(flushedLines);
        expect(recovered.length).toBeLessThanOrEqual(events.length);
      },
    ));
  });

  it('raises on any complete line that is valid JSON but not an event', () => {
    fc.assert(fc.property(
      fc.array(trajectoryEvent(0), { minLength: 1, maxLength: 3 }),
      fc.oneof(fc.constantFrom('null', '42', '"s"', '[]', '{}'), fc.json()),
      (events, junk) => {
        fc.pre(!isValidEventJson(junk));
        const text = `${writeTrajectoryJsonl(events)}${junk.replaceAll('\n', ' ')}\n`;
        expect(() => parseTrajectoryJsonl(text)).toThrow(TrajectoryParseError);
      },
    ));
  });
});

const playbook = (verifyText: string, argValue: string): Playbook => ({
  playbook: 'property-playbook',
  version: 1,
  task_signature: {
    intent_description: 'do the thing',
    env_fingerprint: { domain: 'portal.test', tool_prefixes: ['browser.'] },
  },
  params: [],
  steps: [{
    kind: 'deterministic', id: 's1', tool: 'browser.fill', depends_on: [], on_fail: 'fallback',
    args: { selector: '#field', value: argValue },
  }],
  verify: [{ text_visible: verifyText }],
  confidence: 1,
});

describe('playbook YAML serializer properties', () => {
  it('round-trips any playbook whose strings YAML could misread as another type', () => {
    // A playbook read back with `verify: true` instead of `verify: "true"` is
    // an unloadable playbook — or worse, a verification that means something
    // else. Both halves must survive the format, not just typical text.
    fc.assert(fc.property(hostileString, hostileString, (verifyText, argValue) => {
      const source = PlaybookSchema.safeParse(playbook(verifyText, argValue));
      fc.pre(source.success);
      expect(parsePlaybookYaml(writePlaybookYaml(source.data))).toEqual(source.data);
    }));
  });
});

function isValidEventJson(text: string): boolean {
  try {
    const events = parseTrajectoryJsonl(`${text.replaceAll('\n', ' ')}\n`, { tolerateTrailingPartialLine: false });
    return events.length > 0;
  } catch {
    return false;
  }
}
