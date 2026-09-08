---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

SSE broadcast, access-invalidation, and the feature-toggles cache-sync now
all fan out correctly across `replicas > 1`. Previously all three ran as
`delivery: "per-instance"` consumers, which only works when every process
has a distinct `KUMIKO_INSTANCE_ID` — in production that value is pinned to
a fixed string, so all pods shared one cursor row and each consumer only
ever saw a random subset of events.

`buildServer` now defaults to a Redis-backed `SseBroker` (`createRedisSseBroker`,
new export) whenever `REDIS_URL` is set: one pod publishes, every pod's
broker republishes to its own local clients over Redis Pub/Sub. An
explicitly-passed `ServerOptions.sseBroker` still always wins. Without
`REDIS_URL` the behavior is unchanged (in-memory `createSseBroker`, single
process only).

The generic Pub/Sub mechanics behind that broker are now factored out into
`createRedisPubSubSignal` (`@cosmicdrift/kumiko-framework/redis`) — two
ioredis connections (publish + subscribe), one `psubscribe` on a caller
pattern, JSON payloads, defensive parse-and-drop on malformed messages.
`feature-toggles` builds its own transport on top of the same primitive via
the new `createRedisToggleSyncSignal` (`@cosmicdrift/kumiko-bundled-features/feature-toggles`):
`GlobalFeatureToggleRuntime` now takes an optional `syncSignal`, and its new
`broadcastToggle()` publishes a flip to every other process when one is
configured, falling back to the old direct-apply behavior when it isn't
(no `REDIS_URL` — single-process dev/test, unchanged).

With real transports in place under all three, `system:consumer:sse-broadcast`,
`system:consumer:access-invalidation`, and `feature-toggles:projection:toggle-cache-sync`
all moved to `delivery: "shared"` (one cursor reads every event once, fanout
happens through the respective signal) with `startFrom: "now"` so existing
deploys don't replay their full event history on first boot after
upgrading. Their old per-instance cursor rows are cleaned up automatically
on the next `kumiko-schema apply`.

No consumer anywhere in `kumiko-framework` or `kumiko-bundled-features` uses
`delivery: "per-instance"` for a production feature any more — that's the
statement `replicas > 1` correctness now rests on. App-authors: wire
`createRedisToggleSyncSignal(REDIS_URL)` into `createFeatureToggleRuntime`
the same way `REDIS_URL` already gates the SSE broker, so a multi-replica
deploy's feature-toggle flips actually converge across pods.
