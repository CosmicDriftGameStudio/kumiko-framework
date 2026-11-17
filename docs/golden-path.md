---
status: reference
verified: 2026-11-17
---

# Golden path: from entity to tested screen

One feature, six steps, every step in its canonical form. The code is the
recipe [`samples/recipes/golden-path`](../samples/recipes/golden-path/). It is
type-checked and its test runs in CI, so the code stays in step with the
framework. Each step below names the symbol to search for. Read the file next to this page.

Feature file: [`src/feature.ts`](../samples/recipes/golden-path/src/feature.ts).
Test file: [`src/__tests__/feature.integration.test.ts`](../samples/recipes/golden-path/src/__tests__/feature.integration.test.ts).

## 1. Entity

[`ticketEntity`](../samples/recipes/golden-path/src/feature.ts) is a
`createEntity({ table, fields })`. Every text field states whether it holds
personal data. `r.crud("ticket", ticketEntity, { write, read, verbs })`
registers the entity
with its create, list and detail handlers. Each side names its access rule;
without one, boot stops. The table is a projection of the entity's events, so
you never write it directly.

## 2. Write handler

`r.writeHandler({ name, schema, access, handler })`
is the only way to
change state. The Zod `schema` is the input boundary, `access` is default deny,
and the handler returns a typed result: `failNotFound(...)` for a missing
ticket, `{ isSuccess: true, data }` otherwise. The qualified name that clients
and tests use is `ticketing:write:ticket:close`.

## 3. Event

`r.defineEvent("ticket-closed", schema, { piiFields })`
declares the event
and its payload. `emitEvent(ctx, ticketClosed, { aggregateId, aggregateType,
payload })` appends
it to the ticket's stream in the handler's transaction. The handler states
what happened; it does not update a row.

## 4. Projection

`r.projection({ name, source, table, apply })`
folds events into a
read model. `apply` is keyed by event name; `setFields(table, { isClosed: true })`
is the shortcut for "update the aggregate's row". The projection runs inline,
so the read model is current when the write returns. A rebuild of the ticket table replays it too: an `r.projection` on an entity's own table is merged into the entity's rebuild.

## 5. Screen

`r.screen({ id, type: "entityList", entity, columns })`
declares the list
page. The renderer builds it from the declaration; there is no JSX. Boot
validation checks that the columns exist on the entity.

## 6. Test

The test boots the real server and database with `setupTestStack` from
`@cosmicdrift/kumiko-testing/stack`
and talks to it through `stack.http.writeOk`, `writeErr` and `queryOk`. The
central case, [closing a ticket](../samples/recipes/golden-path/src/__tests__/feature.integration.test.ts),
writes through the handler and reads the projection back. Two more cases cover
the access rule and the not-found failure. Each test uses its own tenant, so no
test sees another's rows.

## Where to go next

- Rules for agents and contributors: [`AGENTS.md`](../AGENTS.md).
- Folder layout of a real app feature: [app-feature-structure](reference/app-feature-structure.md).
- Every recipe, one per concept: [`agents/examples.md`](../packages/framework/agents/examples.md).
