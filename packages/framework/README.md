# @kumiko/framework

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)

Framework core for Kumiko — engine, pipeline, API, DB, event-store, and
every other bit that makes Kumiko go.

> Multi-tenant, command-based, event-sourced app framework for Bun + Hono +
> Drizzle. Define features, register entities, write commands — the framework
> wires dispatch, persistence, projections, async subscribers, and realtime
> delivery.

See the [monorepo root README](../../README.md) for the broader pitch, the
[docs/plans](../../docs/plans) directory for architecture, and [samples/](../../samples)
for runnable examples of every feature.

## Install

```bash
yarn add @kumiko/framework
# peers you probably already have:
yarn add drizzle-orm hono ioredis zod
```

Bun is the intended runtime. Node 20+ works for the CLI and tests.

## At-a-glance

```typescript
import { defineFeature, createEntity, createTextField } from "@kumiko/framework/engine";

export const taskEntity = createEntity({
  fields: {
    title: createTextField({ required: true, searchable: true }),
    done: createTextField(),
  },
  softDelete: true,
});

export const taskFeature = defineFeature("tasks", (r) => {
  r.entity("task", taskEntity);

  // CRUD + optimistic locking + access control + event-sourced writes
  r.crud("task", {
    access: {
      create: { roles: ["User"] },
      update: { roles: ["User"] },
      delete: { roles: ["Admin"] },
      list: { openToAll: true },
      detail: { openToAll: true },
    },
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
| `@kumiko/framework/engine` | `defineFeature`, `createEntity`, field helpers, access rules, registry |
| `@kumiko/framework/db` | Drizzle re-exports, `createEventStoreExecutor`, table builders, tenant-db |
| `@kumiko/framework/event-store` | `events` table, `append`, `loadAggregate`, `loadAggregateAsOf` |
| `@kumiko/framework/pipeline` | Dispatcher, event-dispatcher (AsyncDaemon), projection-rebuild, SSE + search consumers |
| `@kumiko/framework/api` | `buildServer`, auth middleware, SSE route, error contract |
| `@kumiko/framework/auth` | JWT helper, password hashing, session users |
| `@kumiko/framework/search` | `SearchAdapter` interface, in-memory adapter, Meili wrapper |
| `@kumiko/framework/jobs` | BullMQ-backed job runner, cron scheduling |
| `@kumiko/framework/files` | Signed-URL upload/download, tenant-scoped storage |
| `@kumiko/framework/i18n` | i18next setup, per-feature translation registration |
| `@kumiko/framework/ui` | React hooks (Zustand stores, SSE subscription, optimistic mutations) |
| `@kumiko/framework/testing` | `setupTestStack`, `createTestDb`, request helpers |
| `@kumiko/framework/utils` | Safe JSON, qualified-name helpers |
| `@kumiko/framework/errors` | Error classes, `writeFailure`, reason contracts |

## Core concepts

- **Feature as unit of deployment.** `defineFeature` registers entities, CRUD,
  projections, post-event subscribers, lifecycle hooks, access rules, and
  translations.
- **Commands in, state out.** Writes are commands dispatched through HTTP;
  the dispatcher validates, enforces access, runs lifecycle hooks, persists
  events, and triggers projections in a single TX.
- **Event-sourced by default.** `r.crud()` generates event-backed handlers
  — every write appends a `<entity>.created/updated/deleted/restored` event.
  Projections feed off the stream for same-TX read-after-write consistency.
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

MIT — see [LICENSE](../../LICENSE).
