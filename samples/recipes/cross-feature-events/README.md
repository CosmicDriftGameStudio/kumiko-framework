# Cross-Feature Reactions

A handler emits a typed domain event onto the aggregate stream, and an
async MultiStreamProjection reacts. Since Sprint E this is the
Marten-gold-standard path for cross-feature reactions — the old
`ctx.emit` + `r.postEvent` branch was removed in E.2.

## What the sample shows

Three building blocks:

- **`r.defineEvent("name", zodSchema)`** declares the name and payload.
  The qualified name (e.g. `pubsub-orders:event:order-placed`) comes
  back as `.name` — pass it directly to `ctx.appendEvent`. Events that
  aren't registered are rejected by `ctx.appendEvent` at the emit site.

- **`ctx.appendEvent({ aggregateId, aggregateType, type, payload })`**
  appends the event onto the aggregate stream within the same TX.
  Version lineage is continued automatically — no synthetic
  `"pubsub"` stream anymore, the event truly lives on the aggregate.

- **`r.multiStreamProjection({ name, apply })`** declares a consumer.
  The event dispatcher walks the `events` table via cursor and
  delivers **at-least-once** in event-ID order. `table` can be omitted
  — the MSP then becomes a pure side effect (send mail, webhook,
  external system). With `table`, the apply materializes a persistent
  read model.

## Flow

```
HTTP → writeHandler
         ↓ TX begin
         orderExecutor.create(...)     ← business row + auto-event (pubsubOrder.created, v1)
         ctx.appendEvent({...})        ← domain event (pubsub-orders:event:order-placed, v2)
         ↓ TX commit
         (async, post-commit)
         event-dispatcher runOnce
         ↓ per-consumer cursor advance
         MSP apply → capture side effect
```

## Migration note

`r.postEvent` was removed in Sprint E.2. `ctx.appendEvent` +
`r.multiStreamProjection` is the unified Marten API for CRUD events,
domain events, and cross-feature reactions.

## Test

The integration test pins three guarantees:

1. **TX atomicity** — after commit the event row sits in the `events`
   table on the aggregate stream (not on a synthetic `"pubsub"`
   stream).
2. **MSP delivery** — `runOnce()` delivers the event to the handler
   with the correct `tenantId` + payload.
3. **Rollback safety** — when the write fails, neither the business
   row nor the event row nor the MSP side effect exists.

```bash
yarn kumiko test integration samples/cross-feature-events
```
