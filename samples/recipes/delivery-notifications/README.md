# Sample: Delivery Notifications

Shows how a feature sends notifications to multiple channels (InApp + Email + Push) without knowing the channel internals, and how the mail text lives in the template store where a tenant can override it.

## What you learn here

**Declarative notifications:** `r.notification()` declares the mail variables, the default mail text, the subject and the short inApp/push texts in one place.

**Mail text is stored data:** The boot seed (`seedNotificationTemplates`) writes the declared `template` and `meta` into the template store as system templates. The email channel renders them with `renderer-mail-html`. A notification routed to email without `template` and `meta` fails its delivery.

**Tenant override:** A tenant admin overrides the text through the template-resolver handlers (`upsertTenant`, then `publish`). The next mail for that tenant uses the override; the system text stays for everyone else.

**Sending:** The write handler calls `ctx.notify(type, { to, data })`. The `data` keys are the template variables; sending fails loudly when a required variable is missing.

**Swappable transports:** Email uses `InMemoryTransport` in tests; in a production setup it would be SMTP. Same interface, different implementation.

## Feature composition

The test loads these features together:

```
config            → tenant/system config
tenant            → memberships (delivery needs tenant:query:resolve-user-ids)
template-resolver → template store, override handlers
renderer-foundation + renderer-mail-html → renders kind "mail"
delivery          → core: ctx.notify, DeliveryLog, Preferences, extension points
channel-inApp / channel-email / channel-push
support           → our business logic (tickets + the notification declaration)
```

The `support` feature `r.requires({ features: ["delivery"] })`: channels are features that attach to delivery, but `support` doesn't need to know them.

## Flow

1. The boot seed stores the `ticket-assigned` mail template
2. Admin calls `support:write:ticket:create` over HTTP
3. The handler inserts the ticket and calls `ctx.notify` for the assignee (no assignee, no notification)
4. For each registered channel:
   - InApp: `templates.inApp(data)`, DB insert + SSE push
   - Email: stored template rendered with `data` as variables, then transport
   - Push: `templates.push(data)`, transport
5. DeliveryLog entry per channel

## Tests

- **E2E happy path:** Ticket with assignee → InApp + Email + Push + 3 DeliveryLog entries
- **Tenant override:** a published tenant template replaces the system mail text
- **Skip:** Ticket without assignee → no notifications
- **Access control:** Non-Admin/Support can't create tickets
