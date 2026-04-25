# Cross-Feature Reactions

Ein Handler emittiert ein typisiertes Domain-Event auf den Aggregate-Stream, eine asynchrone
MultiStreamProjection reagiert darauf. Seit Sprint E der Marten-Gold-Standard-Pfad für
cross-feature-Reaktionen — der alte `ctx.emit` + `r.postEvent`-Zweig ist mit E.2 entfernt.

## Was zeigt das Sample

Drei Bausteine:

- **`r.defineEvent("name", zodSchema)`** deklariert Name und Payload. Der qualifizierte Name
  (z.B. `pubsub-orders:event:order-placed`) kommt als `.name` zurück — direkt an
  `ctx.appendEvent` übergeben. Events die nicht registriert sind lehnt `ctx.appendEvent`
  bereits am Emit-Site ab.

- **`ctx.appendEvent({ aggregateId, aggregateType, type, payload })`** hängt das Event innerhalb
  derselben TX an den Aggregate-Stream an. Version-Lineage wird automatisch fortgeschrieben —
  kein synthetischer `"pubsub"`-Stream mehr, das Event lebt wirklich zum Aggregate.

- **`r.multiStreamProjection({ name, apply })`** deklariert einen Consumer. Der
  event-dispatcher läuft per Cursor über die `events`-Tabelle und liefert **at-least-once**
  in Event-ID-Reihenfolge aus. `table` kann weggelassen werden — dann ist die MSP reiner
  Side-Effect (Mail senden, Webhook, externes System). Mit `table` wird die Apply in einem
  persistenten Read-Model materialisiert.

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

## Migrationshinweis

`r.postEvent` ist mit Sprint E.2 entfernt. `ctx.appendEvent` + `r.multiStreamProjection` ist
die einheitliche Marten-API für CRUD-Events, Domain-Events und Cross-Feature-Reactions.

## Test

Der Integration-Test pinnt drei Garantien:

1. **TX-Atomicity** — Event-Row liegt nach dem Commit in der `events`-Tabelle, auf dem
   Aggregate-Stream (nicht auf einem synthetischen `"pubsub"`-Stream).
2. **MSP-Delivery** — `runOnce()` liefert das Event an den Handler, mit korrektem
   `tenantId` + Payload.
3. **Rollback-Sicherheit** — schlägt die Write fehl, existiert weder Business-Row noch
   Event-Row noch MSP-Seiteneffekt.

```bash
yarn kumiko test integration samples/cross-feature-events
```
