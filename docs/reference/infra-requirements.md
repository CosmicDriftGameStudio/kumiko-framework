---
status: reference
verified: 2026-07-14
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
started and not required.

## Full-stack deployments

Anything using the bundled `mail-transport-smtp`, `subscription-stripe` /
`subscription-mollie`, `files-provider-s3`, or `inbound-provider-imap`
features additionally needs the respective external service (SMTP relay,
payment provider, S3-compatible storage, IMAP mailbox) — those are per-feature
provider dependencies, not core infra, and are opt-in via which
bundled-feature you mount.

## Local dev stack

`docker-compose.yml` starts the full stack (Postgres, Redis, Meilisearch,
MinIO, Ollama, Faster-Whisper) for convenience — that is a dev-time
superset, not a statement about what a given deployment must run in
production.
