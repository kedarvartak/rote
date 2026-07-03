import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { TrajectoryEventSchema } from '../src/schemas/trajectory-event.js';

const resultRefArb = fc.oneof(
  fc.record({ kind: fc.constant('inline' as const), value: fc.jsonValue() }),
  fc.record({ kind: fc.constant('blob' as const), path: fc.string({ minLength: 1 }) }),
);

const trajectoryEventArb = fc.record({
  run_id: fc.string({ minLength: 1 }),
  seq: fc.nat(),
  ts: fc.date({ min: new Date('2000-01-01'), max: new Date('2100-01-01') }).map((d) => d.toISOString()),
  tool: fc.string({ minLength: 1 }),
  args: fc.dictionary(fc.string({ minLength: 1 }), fc.jsonValue()),
  result_digest: fc.record({
    sha256: fc.hexaString({ minLength: 64, maxLength: 64 }),
    byte_length: fc.nat(),
    preview: fc.string(),
  }),
  result_ref: resultRefArb,
  duration_ms: fc.nat(),
});

function validEvent() {
  return {
    run_id: 'run-1',
    seq: 0,
    ts: new Date().toISOString(),
    tool: 'browser.navigate',
    args: {},
    result_digest: { sha256: 'a'.repeat(64), byte_length: 0, preview: '' },
    result_ref: { kind: 'inline' as const, value: null },
    duration_ms: 10,
  };
}

describe('TrajectoryEventSchema', () => {
  it('round-trips through parse(serialize(x)) for arbitrary valid events', () => {
    fc.assert(
      fc.property(trajectoryEventArb, (event) => {
        // Normalize through one JSON pass before the first parse: JSON has no
        // negative zero (JSON.stringify(-0) === "0"), so an arbitrary-generated
        // -0 in `args` would make the *first* parse differ from a value that,
        // like every real event, has already been through a JSON boundary at
        // least once (fast-check found this — see CHANGELOG). The invariant
        // this test actually owes is "write then read is idempotent", not
        // "arbitrary in-memory JS values survive JSON with float sign intact".
        const parsed = TrajectoryEventSchema.parse(JSON.parse(JSON.stringify(event)) as unknown);
        const reparsed = TrajectoryEventSchema.parse(JSON.parse(JSON.stringify(parsed)) as unknown);
        expect(reparsed).toEqual(parsed);
      }),
    );
  });

  it('rejects a negative seq', () => {
    expect(TrajectoryEventSchema.safeParse({ ...validEvent(), seq: -1 }).success).toBe(false);
  });

  it('rejects a non-integer seq', () => {
    expect(TrajectoryEventSchema.safeParse({ ...validEvent(), seq: 1.5 }).success).toBe(false);
  });

  it('rejects a sha256 that is not 64 characters', () => {
    const event = validEvent();
    event.result_digest.sha256 = 'too-short';
    expect(TrajectoryEventSchema.safeParse(event).success).toBe(false);
  });

  it('accepts an event with an error field', () => {
    expect(
      TrajectoryEventSchema.safeParse({ ...validEvent(), error: { message: 'timeout' } }).success,
    ).toBe(true);
  });

  it('rejects an unparseable ts', () => {
    expect(TrajectoryEventSchema.safeParse({ ...validEvent(), ts: 'not-a-date' }).success).toBe(false);
  });
});
