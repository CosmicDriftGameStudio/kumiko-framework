# Sample: Delivery Notifications

Zeigt wie ein Feature Notifications an mehrere Channels sendet (InApp + Email + Push) ohne die Channel-Interna zu kennen.

## Was lernt man hier

**Deklarative Notifications:** `r.notification()` feuert automatisch nach einem CRUD Handler — der Feature-Entwickler schreibt keinen einzigen `ctx.notify()` Call.

**Per-Channel Templates:** Jeder Channel bekommt nur die Daten die er braucht. InApp kriegt kurzen `title/body`, Email kriegt strukturierte `sections` für den Renderer, Push kriegt kompakten Text.

**Austauschbare Transports:** Email nutzt `InMemoryTransport` im Test, im Produktions-Setup wäre es SMTP. Gleiches Interface, andere Implementation.

## Feature-Komposition

Der Test lädt **7 Features** zusammen:

```
config        → Tenant/System Config
tenant        → Memberships (Delivery braucht tenant:query:resolve-user-ids)
delivery      → Core: ctx.notify, DeliveryLog, Preferences, Extension Points
channel-inApp → r.useExtension("deliveryChannel", "inApp", ...)
channel-email → r.useExtension("deliveryChannel", "email", ...) + renderer + transport
channel-push  → r.useExtension("deliveryChannel", "push", ...) + transport
renderer-simple → r.useExtension("notificationRenderer", "simple", ...)
support       → unsere Business-Logic (Tickets + Notification-Definitionen)
```

Das `support` Feature `r.requires("delivery")` — die Channels sind Features die sich an Delivery anhängen, aber `support` muss sie nicht kennen.

## Flow

1. Admin ruft `support:write:ticket:create` per HTTP
2. CrudExecutor insertet Ticket, gibt `SaveContext` zurück
3. Lifecycle Pipeline: postSave Hook der `r.notification("ticket-assigned")` feuert
4. `recipient(result)` → assigneeId oder `null` (skip)
5. `data(result)` → Rohdaten (title, description, ticketId, priority)
6. Für jeden registrierten Channel:
   - `templates[channelName](data)` transformiert in channel-spezifisches Format
   - InApp: DB Insert + SSE Push
   - Email: Renderer → HTML → Transport
   - Push: Transport
7. DeliveryLog Eintrag pro Channel

## Tests

- **E2E Happy Path:** Ticket mit Assignee → InApp + Email + Push + 3 DeliveryLog Einträge
- **Recipient Null Skip:** Ticket ohne Assignee → keine Notifications
- **Access Control:** Non-Admin/Support kann keine Tickets erstellen
