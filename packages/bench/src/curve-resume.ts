import { parseCurveStepJsonl } from './curve-protocol.js';

/** Validated append plan for a curve output file. */
export interface CurveResumePlan {
  completedRunIds: ReadonlySet<string>;
  initializeEmptyFile: boolean;
}

/** Refuses overwrite and derives completed run ids from validated existing JSONL. */
export function planCurveResume(existing: string | undefined, resume: boolean, path: string): CurveResumePlan {
  if (!resume && existing) {
    throw new Error(`output already contains records: ${path}; pass --resume or choose a new path`);
  }
  const records = existing ? parseCurveStepJsonl(existing) : [];
  return {
    completedRunIds: new Set(records.filter((record) => record.step_outcome !== 'continued').map((record) => record.run_id)),
    initializeEmptyFile: existing === undefined,
  };
}
