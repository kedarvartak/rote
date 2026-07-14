import { z } from 'zod';

/** Explicit browser replay candidate selected before any future semantic matcher runs. */
export const BrowserReplayCandidateSchema = z.object({
  playbook_path: z.string().min(1),
  fingerprint_hash: z.string().length(64),
  params: z.record(z.string(), z.unknown()).default({}),
});
export type BrowserReplayCandidate = z.infer<typeof BrowserReplayCandidateSchema>;
