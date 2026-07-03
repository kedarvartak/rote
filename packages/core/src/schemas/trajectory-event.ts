import { z } from 'zod';
import { ResultDigestSchema, ResultRefSchema } from '../digest.js';

/**
 * One recorded tool call. The Recorder (M1) taps every call during a normal
 * agent run and appends one of these; the Distiller (M5) turns a successful
 * run's events into a Playbook. See docs/02-architecture.md "Recorder".
 */
export const TrajectoryEventSchema = z.object({
  run_id: z.string().min(1),
  seq: z.number().int().nonnegative(),
  ts: z.string().datetime(),
  tool: z.string().min(1),
  args: z.record(z.string(), z.unknown()).default({}),
  result_digest: ResultDigestSchema,
  result_ref: ResultRefSchema,
  duration_ms: z.number().nonnegative(),
  error: z
    .object({
      message: z.string().min(1),
      code: z.string().optional(),
    })
    .optional(),
});
export type TrajectoryEvent = z.infer<typeof TrajectoryEventSchema>;
