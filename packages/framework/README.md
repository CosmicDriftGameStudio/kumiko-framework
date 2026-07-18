# @cosmicdrift/kumiko-framework

[![License: BUSL-1.1](https://img.shields.io/badge/License-BUSL--1.1-blue.svg)](../../LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)

Framework core for Kumiko — engine, pipeline, API, DB, event-store, and
every other bit that makes Kumiko go.

> Multi-tenant, command-based, event-sourced app framework for Bun + Hono +
> Postgres. Define features, register entities, write commands — the framework
> wires dispatch, persistence, projections, async subscribers, and realtime
> delivery.

See the [monorepo root README](../../README.md) for the broader pitch, the
[docs/plans](../../docs/plans) directory for architecture, and [samples/](../../samples)
for runnable examples of every feature.

## Install

```bash
bun add @cosmicdrift/kumiko-framework
# peers you probably already have:
bun add hono ioredis zod
```

Bun is the intended runtime and test runner.

## At-a-glance

```typescript
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const taskEntity = createEntity({
  table: "read_tasks",
  fields: {
    title: createTextField({ required: true, searchable: true }),
    done: createTextField(),
  },
  softDelete: true,
});

export const taskFeature = defineFeature("tasks", (r) => {
  // r.crud wires create/update/delete/restore + list/detail queries in one
  // call — events + projection in the same TX, optimistic locking, access
  // control, all explicit via the options below.
  r.crud("task", taskEntity, {
    write: { access: { roles: ["User"] } },
    read: { access: { openToAll: true } },
  });

  // Read-model fed from task events, rebuildable via the CLI
  r.projection({
    name: "tasks-per-day",
    source: "task",
    table: tasksPerDayTable,
    apply: {
      "task.created": async (event, tx) => {
        /* count++ */
      },
    },
  });

  // Async consumer — runs after commit via the event-dispatcher,
  // cursor-based, at-least-once, per-consumer dead-letter semantics.
  // Omit `table` for pure side-effect handlers (mail, webhooks, ...).
  r.multiStreamProjection({
    name: "notify-new-task",
    apply: {
      "task.created": async (event) => {
        // e.g. push to an external notification service
      },
    },
  });
});
```

## Package exports

| Entry | What's in it |
|---|---|
| `@cosmicdrift/kumiko-framework/engine` | `defineFeature`, `createEntity`, field helpers, access rules, registry |
| `@cosmicdrift/kumiko-framework/db` | `buildEntityTableMeta`, `createEventStoreExecutor`, migrations, tenant-db |
| `@cosmicdrift/kumiko-framework/event-store` | `events` table, `append`, `loadAggregate`, `loadAggregateAsOf` |
| `@cosmicdrift/kumiko-framework/pipeline` | Dispatcher, event-dispatcher (AsyncDaemon), projection-rebuild, SSE + search consumers |
| `@cosmicdrift/kumiko-framework/api` | `buildServer`, auth middleware, SSE route, error contract |
| `@cosmicdrift/kumiko-framework/auth` | JWT helper, password hashing, session users |
| `@cosmicdrift/kumiko-framework/search` | `SearchAdapter` interface, in-memory adapter, Meili wrapper |
| `@cosmicdrift/kumiko-framework/jobs` | BullMQ-backed job runner, cron scheduling |
| `@cosmicdrift/kumiko-framework/files` | Signed-URL upload/download, tenant-scoped storage |
| `@cosmicdrift/kumiko-framework/i18n` | i18next setup, per-feature translation registration |
| `@cosmicdrift/kumiko-framework/ui` | React hooks (Zustand stores, SSE subscription, optimistic mutations) |
| `@cosmicdrift/kumiko-framework/testing` | `setupTestStack`, `createTestDb`, request helpers |
| `@cosmicdrift/kumiko-framework/utils` | Safe JSON, qualified-name helpers |
| `@cosmicdrift/kumiko-framework/errors` | Error classes, `writeFailure`, reason contracts |

## Core concepts

- **Feature as unit of deployment.** `defineFeature` registers entities,
  write/query handlers, projections, post-event subscribers, lifecycle hooks,
  access rules, and translations.
- **Commands in, state out.** Writes are commands dispatched through HTTP;
  the dispatcher validates, enforces access, runs lifecycle hooks, persists
  events, and triggers projections in a single TX.
- **Event-sourced by default.** Every write goes through `createEventStoreExecutor`
  and appends a domain event to the aggregate stream. Auto-generated CRUD
  events (`<entity>.created/updated/deleted/restored`) for record writes,
  explicit `ctx.appendEvent` for domain events with intent. Projections feed
  off the stream for same-TX read-after-write consistency.
- **Async side-effects via cursor.** SSE broadcast, search indexing, and
  feature-registered `r.multiStreamProjection` consumers run on a single
  cursor-based dispatcher (AsyncDaemon pattern). Per-consumer checkpoints,
  halt-on-poison, dead-letter after N retries.
- **Multi-tenant scoping.** Every event, entity, projection, and search
  index carries `tenantId`. `TenantDb` is a TX-scoped wrapper that refuses
  writes outside the current tenant.
- **Optimistic concurrency.** `UNIQUE(aggregate_id, version)` on events
  gives atomic append + conflict detection; `VersionConflictError` surfaces
  races as a first-class value.
- **Idempotency + dedup.** Request-id backed unique index on the events
  table turns retries into replays. `IdempotencyGuard` caches write
  outcomes per tenant.

## Status

This framework is pre-1.0 and evolves fast. Every feature has a runnable
sample under `samples/`; the roadmap lives in [docs/plans/uebersicht.md](../../docs/plans/uebersicht.md).

## License

BUSL-1.1 — see [LICENSE](../../LICENSE).
