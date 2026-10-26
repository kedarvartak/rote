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
