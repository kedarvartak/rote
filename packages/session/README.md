# `@rote/session`

`VirtualSessionManager` is the lifecycle boundary for a future shadow browser
context. It clones storage state only through an injected adapter, binds every
context to an environment/principal/task digest, tracks document epochs, and
promotes a shadow context only when the live context is still at its source
epoch.

The manager has no browser action method. It cannot dispatch a predicted action.
Storage state is passed between adapter calls and never appears in session refs,
lifecycle events, checkpoints, or logs. Promotion failures leave the live ref
unchanged and retain typed cleanup evidence; stale shadows are discarded before
promotion.

`ShadowPrefetchCoordinator` is the P3.2 prefetch boundary. It parses a strict
action contract, applies the versioned action speculation fence, and calls only
an executor that exposes `dispatchPureRead`. Unknown action kinds and every
effect boundary are discarded before dispatch. Returned observations are
compared by opaque digest plus scope, epoch, document, and context generation;
only an exact match is a hit. Telemetry is append-only and value-free, and the
coordinator has no final-verification or server-mutation path.

`EffectFencedSpeculator` is the P3.3 single-step boundary. It accepts only the
versioned `pure_read` and `local_nav` classes, applies dispatch/concurrency/time
caps, and requires an exact scope, fingerprint, action-contract, context, and
verification-plan receipt before calling the injected atomic promotion hook.
Unclassified actions, stale receipts, prediction misses, and promotion failures
are typed append-only discard events.

`BoundedSpeculativePipeline` composes those single-step fences with explicit
depth, confidence, concurrency, step-count, and duration budgets. Dependencies
must promote before a child starts; a failed or stale step, cancellation, cycle,
or budget breach drains queued work and records a quiesced event. It never
dispatches directly and cannot report an unverified speculative success.
