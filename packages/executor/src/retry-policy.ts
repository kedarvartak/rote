/**
 * v1 retry tuning is a fixed executor-level constant, not per-step-authored
 * (`OnFailSchema` in `@rote/core` is a bare `retry | repair | fallback`
 * enum with no attempt count — see packages/executor/README.md "Known v1
 * limitations"). `maxAttempts` counts the *total* tries including the
 * first, matching docs/06-build-plan.md M2's retry test: "fails twice,
 * succeeds third -> success with 3 attempts recorded."
 */
export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  backoffMs: 0,
};
