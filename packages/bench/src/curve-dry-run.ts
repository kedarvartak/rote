import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { CurveStepRecordSchema, parseCurveProtocol, parseCurveStepJsonl, type CurveProtocol, type CurveStepRecord } from './curve-protocol.js';

const ZERO_USAGE = {
  input_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  output_tokens: 0,
} as const;

/** Renders non-evidentiary rows that exercise every protocol checkpoint and JSONL field. */
export function renderCurveDryRun(protocol: CurveProtocol): string {
  const records: CurveStepRecord[] = protocol.checkpoints.flatMap((checkpoint) => (
    Array.from({ length: checkpoint.target_steps }, (_, index) => CurveStepRecordSchema.parse({
      schema_version: 1,
      record_kind: 'dry_run',
      protocol_id: protocol.protocol_id,
      task_id: checkpoint.id,
      harness: 'dry-run',
      provider: protocol.provider,
      model: protocol.model,
      run_id: `dry-run-${checkpoint.id}`,
      repetition: 1,
      target_steps: checkpoint.target_steps,
      step_index: index + 1,
      source: 'planner',
      duration_ms: 0,
      usage: ZERO_USAGE,
      cumulative_usage: ZERO_USAGE,
      provider_usage: { dry_run: true },
      step_outcome: 'dry_run',
    }))
  ));
  return records.map((record) => JSON.stringify(record)).join('\n') + '\n';
}

/** Validates a protocol, writes its dry-run JSONL, then reads it back through the public parser. */
export async function writeCurveDryRun(protocolPath: string, outPath: string): Promise<number> {
  const protocol = parseCurveProtocol(JSON.parse(await readFile(resolve(protocolPath), 'utf8')));
  const jsonl = renderCurveDryRun(protocol);
  const records = parseCurveStepJsonl(jsonl);
  await mkdir(dirname(resolve(outPath)), { recursive: true });
  await writeFile(resolve(outPath), jsonl, 'utf8');
  return records.length;
}
