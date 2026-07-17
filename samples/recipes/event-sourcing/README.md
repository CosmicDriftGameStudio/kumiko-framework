# Event Sourcing Showcase

Production-pattern sample showing every Sprint-E Marten-gold-standard
API in one feature. Serves as a reference for all the ES building
blocks Kumiko provides.

## What the sample shows

| API | Purpose |
|---|---|
| `r.defineEvent(name, schema, { version, migrations })` | Event schema with version number + upcaster chain |
| `ctx.appendEvent({ aggregateId, aggregateType, type, payload })` | Domain event on aggregate stream |
| `r.projection(...)` | Single-stream read model, inline in the write TX |
| `r.multiStreamProjection(...)` | Cross-aggregate read model, async via dispatcher |
| `ctx.loadAggregate(id, { asOf })` | Live aggregation with point-in-time |
| `ctx.archiveStream(id, { aggregateType })` | Archive a stream (Marten `ArchiveStream`) |
| `ctx.queryProjection(name)` | Tenant-scoped read-model query |

## Domain

Invoices flow through `draft` → `approved` → `paid` → (optional)
`archived`. Two read models:

- **`invoice-detail`** (single-stream, inline): one row per invoice,
  reacts to `created`, `approved`, `paid`.
- **`customer-revenue`** (multi-stream, async): one row per customer,
  sums up paid invoices.

The `approved` event is at schema version 2 — v1 stored `amount` as a
string, v2 uses `amountCents` as an integer. The migration shows how
old events are transparently upcast on read.

## Flow

```
HTTP POST /api/write { type: "showcase:write:invoice:create", ... }
         ↓
  writeHandler("invoice:create")
         ↓ TX begin
         invoiceExecutor.create(...)            ← auto event: showcaseInvoice.created
         r.projection("invoice-detail")         ← inline, writes detail row
         ↓ TX commit

HTTP POST /api/write { type: "showcase:write:invoice:approve", ... }
         ↓
  writeHandler("invoice:approve")
         ↓ TX begin
         ctx.appendEvent({ type: "showcase:event:invoice-approved", ... })
         r.projection("invoice-detail")         ← updates status = "approved"
         ↓ TX commit
         (async)
         eventDispatcher.runOnce()
         ↓
         r.multiStreamProjection("customer-revenue")  ← skips (only on paid)
```

## Test

```bash
bun kumiko test integration samples/recipes/event-sourcing
```

Six integration tests pin everything at once:

1. Walk-through `create → approve → pay` with the inline projection
2. Async MSP accumulates across multiple paid invoices
3. `asOf` returns the state before payment
4. v1 event on disk reaches the reducer as v2 (upcaster)
5. `archiveStream` hides events from `loadAggregate`; ops bypass via `{ includeArchived }`
6. `queryProjection` automatically filters by `tenant_id`
