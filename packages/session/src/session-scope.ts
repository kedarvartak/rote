import { z } from 'zod';

/** Opaque digest binding a session to one environment, principal, and task. */
export const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const SessionScopeSchema = z.object({
  environment_digest: DigestSchema,
  principal_digest: DigestSchema,
  binding_digest: DigestSchema,
}).strict();
export type SessionScope = z.infer<typeof SessionScopeSchema>;
