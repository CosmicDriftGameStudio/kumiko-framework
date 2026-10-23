---
status: reference
verified: 2026-10-23
---

# Infrastructure requirements by feature

What a Kumiko deployment actually needs to run, broken down by which
capability pulls in which piece of infrastructure. Postgres is the only hard
requirement; everything else is additive and only needed if you use the
feature that depends on it.

## Postgres-only (always required)

Core engine, event store, entity tables, tenant/user/sessions, auth,
compliance/audit, config/secrets, billing, files (`file-provider-inmemory` or
S3), mail (SMTP transport). None of this touches Redis or Meilisearch.

### Database user and name for the migrate step

`kumiko-init-deploy` writes `deploy/migrate-step.sh`, which connects as
`postgresql://<dbUser>:<password>@db:5432/<dbName>`. Both default to the app
name. When the database was created under another name, set them in the app's
`package.json`:

```json
{ "kumiko": { "deploy": { "dbUser": "ledger", "dbName": "ledger" } } }
```

Each value must match `^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,62}$`. An invalid value
fails the scaffold instead of producing a script that Postgres rejects at
migrate time.

### Connection budget

Each app or worker pod holds `DATABASE_POOL_MAX` (default 10) connections for
the main pool plus `DATABASE_OUTSIDE_TX_POOL_MAX` (default 3) for the dedicated
pool behind `ctx.dbOutsideTransaction` / `ctx.outsideTransaction`, and one extra
connection for the event dispatcher's LISTEN session. Bun.SQL opens all of a
pool's connections on its first query, not one at a time under load, so a
running pod always holds the full sizes. Keep
`pods × (DATABASE_POOL_MAX + DATABASE_OUTSIDE_TX_POOL_MAX + 1)` below Postgres
`max_connections` minus `superuser_reserved_connections` (default 3), counting
the extra pods of a rolling-update surge. The migrate step opens its own pool of
10 while it runs. Work without a statement timeout, such as a projection rebuild
or a PII backfill, opens up to 4 more on the pod or migrate step that runs it.

## + Redis

Redis is required as soon as any of the following are in use:

| Capability | Source |
|---|---|
| Rate limiting | `packages/framework/src/rate-limit/resolver.ts` |
| Distributed locking (write-handler concurrency) | `packages/framework/src/pipeline/distributed-lock.ts` |
| Idempotency keys | `packages/framework/src/pipeline/idempotency.ts` |
| Event dedup | `packages/framework/src/pipeline/event-dedup.ts` |
| Entity read-cache | `packages/framework/src/pipeline/entity-cache.ts` |
| Background jobs (BullMQ) | `packages/framework/src/jobs/job-runner.ts` |
| SSE broadcast (realtime pub/sub) | `packages/framework/src/redis/index.ts`, `stack/redis.ts` |
| Readiness probe includes Redis check once any of the above is wired | `packages/framework/src/api/readiness.ts` |

A deployment with no rate limiting, no jobs, and no realtime SSE can run
Postgres-only — but in practice, realtime SSE is a core selling point of
Kumiko, so most real deployments end up needing Redis.

## + Meilisearch

Only needed if a feature registers a search index
(`packages/framework/src/search/index.ts`,
`packages/framework/src/search/meilisearch-adapter.ts`). Without any
`r.searchIndex(...)` registration in your features, Meilisearch is not
started and not required. The `meilisearch` client package is an optional
peer of `@cosmicdrift/kumiko-framework`: an app that imports
`@cosmicdrift/kumiko-framework/search/meilisearch` adds it itself
(`bun add meilisearch@^0.58.0`); without it that import fails with a message
naming the package.

## Full-stack deployments

Anything using the bundled `mail-transport-smtp`, `subscription-stripe` /
`subscription-mollie`, `file-provider-s3`, or `inbound-provider-imap`
features additionally needs the respective external service (SMTP relay,
payment provider, S3-compatible storage, IMAP mailbox) — those are per-feature
provider dependencies, not core infra, and are opt-in via which
bundled-feature you mount.

## Optional: app version in the event log

`runProdApp` and `runWorkerApp` write one `kumiko:system:app.started` event per
start under the system tenant (stream type `app-instance`). It carries the
version, the instance id (`KUMIKO_INSTANCE_ID`, else `HOSTNAME`, the pod name
on Kubernetes, else the OS hostname) and the start time. Replicas that share
one `KUMIKO_INSTANCE_ID` cannot be told apart in these events, so give each
replica its own (see "Instance id per pod"). The deployment sets
`KUMIKO_APP_VERSION` (and optionally `KUMIKO_GIT_COMMIT`); without a version
the event records `"unknown"`. A failed write is logged and does not stop the
boot. The event type and stream type are exported as `APP_STARTED_EVENT_TYPE` and
`APP_INSTANCE_STREAM_TYPE` from `@cosmicdrift/kumiko-framework/event-store`. A SystemAdmin reads these events through `audit:query:list` with
`scope: "system"`.

## Instance id per pod

Set `KUMIKO_INSTANCE_ID` to the pod name on every replica (Kubernetes downward
API, `metadata.name`). SSE delivery is no longer per instance: the built-in SSE
consumers use one shared cursor and the Redis broker fans events out to every
pod's clients (fw#2625, fw#2630); with several replicas this needs `REDIS_URL`. The id still labels the process in the
`app.started` event and keys the cursor row of any consumer that opts into
`delivery: "per-instance"`. Without a stable id the server generates a random one
per boot, logs a warning, and such a consumer leaves an orphaned cursor row
behind on every restart that pins event pruning.

## Local dev stack

`docker-compose.yml` starts the full stack (Postgres, Redis, Meilisearch,
MinIO, Ollama, Faster-Whisper) for convenience — that is a dev-time
superset, not a statement about what a given deployment must run in
production. Its Postgres runs with `fsync`/`synchronous_commit`/
`full_page_writes` off, since `stack.cleanup()`'s `DROP DATABASE` forces a
synchronous checkpoint that otherwise queues up under parallel test runs;
this trades durability for reset speed on the local dev/test database, never
appropriate for a real deployment. After an unclean shutdown, recreate the
volume (`docker compose down -v && docker compose up -d`) rather than trust
its contents.
