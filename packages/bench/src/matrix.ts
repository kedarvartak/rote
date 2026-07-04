import type { BenchDriver, BenchPhase, BenchResult, BenchTask } from './types.js';

export interface BenchmarkMatrixConfig {
  tasks: BenchTask[];
  phases: BenchPhase[];
  repetitions: number;
  driver: BenchDriver;
}

/**
 * Runs the benchmark matrix in deterministic task → phase → repetition order.
 * Driver errors become failed cells, never missing cells, because docs/06-build-plan.md
 * M3 requires failed runs to mark their matrix cell instead of silently disappearing.
 */
export async function runBenchmarkMatrix(config: BenchmarkMatrixConfig): Promise<BenchResult> {
  const cells: BenchResult['cells'] = [];

  for (const task of config.tasks) {
    for (const phase of config.phases) {
      for (let repetition = 1; repetition <= config.repetitions; repetition += 1) {
        const input = { task, phase, repetition };
        try {
          const output = await config.driver.run(input);
          cells.push({ status: 'success', ...input, ...output });
        } catch (error) {
          cells.push({
            status: 'failure',
            ...input,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  return { cells };
}
