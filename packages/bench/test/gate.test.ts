import { describe, expect, it } from 'vitest';
import { buildBenchReport } from '../src/accounting.js';
import { evaluateM3Gate, renderM3GateResult } from '../src/gate.js';
import { event, manifest } from './helpers.js';

describe('M3 gate', () => {
  it('passes when warm token reduction meets threshold at success parity', () => {
    const report = buildBenchReport([
      {
        status: 'success',
        task: { id: 'B1', name: 'download report' },
        phase: 'cold',
        repetition: 1,
        runId: 'cold',
        manifest: manifest('cold', [{ source: 'planner', input_tokens: 900, output_tokens: 100 }]),
        trajectory: [event('cold', 0), event('cold', 1)],
      },
      {
        status: 'success',
        task: { id: 'B1', name: 'download report' },
        phase: 'warm',
        repetition: 1,
        runId: 'warm',
        manifest: manifest('warm', [{ source: 'matcher', input_tokens: 80, output_tokens: 20 }]),
        trajectory: [event('warm', 0)],
      },
    ]);

    const result = evaluateM3Gate(report);

    expect(result.passed).toBe(true);
    expect(renderM3GateResult(result)).toContain('| B1 | 90.0% | 100.0% | 100.0% | PASS | ok |');
  });

  it('fails on insufficient token reduction or success regression', () => {
    const report = buildBenchReport([
      {
        status: 'success',
        task: { id: 'B1', name: 'download report' },
        phase: 'cold',
        repetition: 1,
        runId: 'cold',
        manifest: manifest('cold', [{ source: 'planner', input_tokens: 900, output_tokens: 100 }]),
        trajectory: [event('cold', 0)],
      },
      {
        status: 'success',
        task: { id: 'B1', name: 'download report' },
        phase: 'warm',
        repetition: 1,
        runId: 'warm',
        manifest: manifest('warm', [{ source: 'matcher', input_tokens: 700, output_tokens: 100 }]),
        trajectory: [event('warm', 0)],
      },
      { status: 'failure', task: { id: 'B1', name: 'download report' }, phase: 'warm', repetition: 2, error: 'fallback' },
    ]);

    const result = evaluateM3Gate(report);

    expect(result.passed).toBe(false);
    expect(result.tasks[0]?.reasons).toEqual([
      'token reduction 20.0% < 80.0%',
      'warm success 50.0% < cold success 100.0%',
    ]);
  });
});
