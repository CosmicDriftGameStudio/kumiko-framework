# Event Sourcing Showcase

Production-Pattern-Sample, das jedes Sprint-E-Marten-gold-standard-API in einem Feature zeigt.
Dient als Referenz für alle ES-Bausteine, die Kumiko anbietet.

## Was das Sample zeigt

| API | Zweck |
|---|---|
| `r.defineEvent(name, schema, { version })` | Event-Schema mit Versionsnummer |
| `r.eventMigration(name, from, to, transform)` | Upcaster für Schema-Evolution |
| `ctx.appendEvent({ aggregateId, aggregateType, type, payload })` | Domain-Event auf Aggregate-Stream |
| `r.projection(...)` | Single-Stream-Read-Model, inline in der Write-TX |
| `r.multiStreamProjection(...)` | Cross-Aggregate-Read-Model, async via Dispatcher |
| `ctx.loadAggregate(id, { asOf })` | Live-Aggregation mit Point-in-Time |
| `ctx.archiveStream(id, { aggregateType })` | Stream archivieren (Marten `ArchiveStream`) |
| `ctx.queryProjection(name)` | Tenant-scoped Read-Model-Abfrage |

## Domain

Rechnungen (Invoices) gehen durch `draft` → `approved` → `paid` → (optional) `archived`. Zwei Read-Models:

- **`invoice-detail`** (single-stream, inline): eine Row pro Invoice, reagiert auf `created`, `approved`, `paid`.
- **`customer-revenue`** (multi-stream, async): eine Row pro Customer, summiert bezahlte Invoices.

Das `approved`-Event hat Schema-Version 2 — v1 speicherte `amount` als String, v2 nutzt `amountCents` als Integer. Die Migration zeigt, wie alte Events beim Lesen transparent upgecastet werden.

## Flow

```
HTTP POST /api/write { type: "showcase:write:invoice:create", ... }
         ↓
  writeHandler("invoice:create")
         ↓ TX begin
         invoiceExecutor.create(...)            ← auto event: showcaseInvoice.created
         r.projection("invoice-detail")         ← inline, schreibt Detail-Row
         ↓ TX commit

HTTP POST /api/write { type: "showcase:write:invoice:approve", ... }
         ↓
  writeHandler("invoice:approve")
         ↓ TX begin
         ctx.appendEvent({ type: "showcase:event:invoice-approved", ... })
         r.projection("invoice-detail")         ← updated status = "approved"
         ↓ TX commit
         (async)
         eventDispatcher.runOnce()
         ↓
         r.multiStreamProjection("customer-revenue")  ← skipt (nur auf paid)
```

## Test

```bash
yarn kumiko test integration samples/recipes/event-sourcing
```

Sechs Integration-Tests pinnen alles gleichzeitig:

1. Durchlauf `create → approve → pay` mit inline-Projection
2. Async MSP akkumuliert über mehrere bezahlte Invoices
3. `asOf` liefert den State vor der Zahlung
4. v1-Event auf Disk erreicht den Reducer als v2 (Upcaster)
5. `archiveStream` versteckt Events via `loadAggregate`; ops bypass per `{ includeArchived }`
6. `queryProjection` filtert automatisch nach `tenant_id`
