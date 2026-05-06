# Sample: Delivery Notifications

Shows how a feature sends notifications to multiple channels (InApp + Email + Push) without knowing the channel internals.

## What you learn here

**Declarative notifications:** `r.notification()` fires automatically after a CRUD handler — the feature author writes zero `ctx.notify()` calls.

**Per-channel templates:** Each channel only receives the data it needs. InApp gets a short `title/body`, Email gets structured `sections` for the renderer, Push gets compact text.

**Swappable transports:** Email uses `InMemoryTransport` in tests; in a production setup it would be SMTP. Same interface, different implementation.

## Feature composition

The test loads **7 features** together:

```
config        → tenant/system config
tenant        → memberships (delivery needs tenant:query:resolve-user-ids)
delivery      → core: ctx.notify, DeliveryLog, Preferences, extension points
channel-inApp → r.useExtension("deliveryChannel", "inApp", ...)
channel-email → r.useExtension("deliveryChannel", "email", ...) + renderer + transport
channel-push  → r.useExtension("deliveryChannel", "push", ...) + transport
renderer-simple → r.useExtension("notificationRenderer", "simple", ...)
support       → our business logic (tickets + notification definitions)
```

The `support` feature `r.requires("delivery")` — channels are features that attach to delivery, but `support` doesn't need to know them.

## Flow

1. Admin calls `support:write:ticket:create` over HTTP
2. CrudExecutor inserts the ticket, returns the `SaveContext`
3. Lifecycle pipeline: postSave hook fires `r.notification("ticket-assigned")`
4. `recipient(result)` → assigneeId or `null` (skip)
5. `data(result)` → raw data (title, description, ticketId, priority)
6. For each registered channel:
   - `templates[channelName](data)` transforms into channel-specific format
   - InApp: DB insert + SSE push
   - Email: renderer → HTML → transport
   - Push: transport
7. DeliveryLog entry per channel

## Tests

- **E2E happy path:** Ticket with assignee → InApp + Email + Push + 3 DeliveryLog entries
- **Recipient null skip:** Ticket without assignee → no notifications
- **Access control:** Non-Admin/Support can't create tickets
