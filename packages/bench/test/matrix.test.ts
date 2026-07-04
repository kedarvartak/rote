import { describe, expect, it } from 'vitest';
import { runBenchmarkMatrix } from '../src/matrix.js';
import { event, manifest } from './helpers.js';

describe('runBenchmarkMatrix', () => {
  it('runs task phase repetition matrix in deterministic order', async () => {
    const seen: string[] = [];
    const result = await runBenchmarkMatrix({
      tasks: [{ id: 'B1', name: 'one' }, { id: 'B2', name: 'two' }],
      phases: ['cold', 'warm'],
      repetitions: 2,
      driver: {
        async run(input) {
          const runId = `${input.task.id}-${input.phase}-${input.repetition}`;
          seen.push(runId);
          return { runId, manifest: manifest(runId, []), trajectory: [event(runId, 0)] };
        },
      },
    });

    expect(seen).toEqual(['B1-cold-1', 'B1-cold-2', 'B1-warm-1', 'B1-warm-2', 'B2-cold-1', 'B2-cold-2', 'B2-warm-1', 'B2-warm-2']);
    expect(result.cells).toHaveLength(8);
    expect(result.cells.every((cell) => cell.status === 'success')).toBe(true);
  });

  it('marks failed driver runs instead of dropping matrix cells', async () => {
    const result = await runBenchmarkMatrix({
      tasks: [{ id: 'B1', name: 'one' }],
      phases: ['cold', 'warm'],
      repetitions: 1,
      driver: {
        async run(input) {
          if (input.phase === 'warm') throw new Error('replay failed');
          return { runId: 'cold', manifest: manifest('cold', []), trajectory: [] };
        },
      },
    });

    expect(result.cells).toEqual([
      expect.objectContaining({ status: 'success', phase: 'cold' }),
      expect.objectContaining({ status: 'failure', phase: 'warm', error: 'replay failed' }),
    ]);
  });
});
