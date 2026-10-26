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
