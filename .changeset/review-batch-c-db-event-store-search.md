---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-types": patch
---

Database, event-store consumer, search and Redis review fixes

`db.global(table)` writes are rejected on executor-managed entity tables, and `unsafeRaw` handles derived through `begin`, `transaction` or `reserve` keep the personal-data gate. Reference sorting and search re-check label and read access plus ownership, and a stale search index can no longer surface another tenant's row. A cross-tenant convention handler reports one audit event per touched row with that row as target.

A failing dispatcher pass no longer records its error on a consumer whose cursor moved in the meantime and skips a row another pass holds locked. A projection rebuild aborts when the configured blind-index key differs from the one used to build the live table. An array `ne` filter on a jsonb column means "does not contain all of these", matching the entity list filter. `date` columns that still hold a timestamptz log a warning once per column.

`kumiko_event_dispatcher_listen_connected` only drops to 0 on a real connection-loss error and is restored when the pre-check recovers. A consumer logs once when it tracks more than 1000 pending gap ranges. The lazy Meilisearch default config no longer overwrites settings stored by an earlier `configure()` after a restart.

Access invalidation publishes through `PubSubSignal.publishConfirmed`, so a Redis failure fails the consumer and the event is redelivered instead of being dropped (`SseBroker.publishAccessInvalidation` may return a promise). `KUMIKO_REDIS_CHANNEL_PREFIX` namespaces the SSE and feature-toggle Pub/Sub channels for apps sharing one Redis; `createRedisToggleSyncSignal` takes the prefix as an optional third argument. Types that mention `Temporal` now carry the `temporal-polyfill/global` reference into their `.d.ts` files.
