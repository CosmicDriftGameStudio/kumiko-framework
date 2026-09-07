---
"@cosmicdrift/kumiko-framework": minor
---

SSE broadcast and access-invalidation now fan out correctly across
`replicas > 1`. Previously both ran as `delivery: "per-instance"` consumers,
which only works when every process has a distinct `KUMIKO_INSTANCE_ID` — in
production that value is pinned to a fixed string, so all pods shared one
cursor row and each SSE client only ever saw a random subset of events.

`buildServer` now defaults to a Redis-backed `SseBroker` (`createRedisSseBroker`,
new export) whenever `REDIS_URL` is set: one pod publishes, every pod's
broker republishes to its own local clients over Redis Pub/Sub. An
explicitly-passed `ServerOptions.sseBroker` still always wins. Without
`REDIS_URL` the behavior is unchanged (in-memory `createSseBroker`, single
process only).

With that transport in place, `system:consumer:sse-broadcast` and
`system:consumer:access-invalidation` moved to `delivery: "shared"` (one
cursor reads every event once, fanout happens through the broker) with
`startFrom: "now"` so existing deploys don't replay their full event history
on first boot after upgrading. Their old per-instance cursor rows are
cleaned up automatically on the next `kumiko-schema apply`.

`feature-toggles`' `toggle-cache-sync` consumer stays `delivery:
"per-instance"` — its handler only mutates a local in-memory `Map`, with no
Redis (or other) transport to reach sibling processes, so a shared cursor
would mean only one process ever learns about a toggle flip. `KUMIKO_INSTANCE_ID`
still needs to be distinct per pod for that one consumer to converge live;
giving it its own cross-replica transport is tracked as a follow-up, not
part of this change.
