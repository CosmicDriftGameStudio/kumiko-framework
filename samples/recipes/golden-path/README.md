# Golden path

The smallest complete Kumiko feature: one entity, one write handler that emits
an event, one projection, one screen, and an integration test that writes
through HTTP and reads the result back. Every other recipe is a variation on
this shape. The walkthrough is in [`docs/golden-path.md`](../../../docs/golden-path.md).

## What it shows

- **Entity** — `ticketEntity` declares `title` and `isClosed`. `r.crud` registers
  `ticket:create`, `ticket:list` and `ticket:detail` for it; update and delete
  are switched off with `verbs`.
- **Write handler** — `ticket:close` checks that the ticket exists and emits the
  `ticket-closed` event. It never touches the table.
- **Event** — `r.defineEvent` declares `ticket-closed` with a Zod payload;
  `emitEvent` appends it to the ticket's stream in the handler's transaction.
- **Projection** — `ticket-status` folds `ticket-closed` into the ticket row
  (`isClosed: true`), in the same transaction as the write.
- **Screen** — `ticket-list` is a declarative `entityList`; the renderer builds
  the UI from it.
- **Test** — `setupTestStack` boots the real server and database;
  `stack.http.writeOk` and `queryOk` go over HTTP. Each test runs in its own
  tenant.

## Files

```
src/feature.ts                          entity, event, handler, projection, screen
src/__tests__/feature.integration.test.ts   write → read back, access, not found
```
