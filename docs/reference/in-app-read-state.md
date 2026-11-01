---
status: reference
verified: 2026-10-31
evidence: "packages/bundled-features/src/channel-in-app/handlers/read-state-by-keys.query.ts; packages/bundled-features/src/channel-in-app/__tests__/inbox.integration.test.ts; packages/bundled-features/src/delivery/channel-context.ts; packages/bundled-features/src/helpdesk/handlers/attempts.ts; packages/types/src/in-app-notification-types.ts"
---

# In-app read state by idempotency key

A sender that notifies a user in the app often needs to know later whether the user opened the note. `notify()` takes an `idempotencyKey`; the delivery service now hands that key to every channel through `ChannelContext.idempotencyKey`, and the in-app channel stores it with the note (`in_app_messages.idempotency_key`, indexed).

`channel-in-app:query:read-state-by-keys` (`IN_APP_NOTIFICATION_QUERIES.readStateByKeys`) answers the read question:

- Input `{ keys: string[] }`, at most 50 keys. Output `{ rows: { key, readAt }[] }` with `readAt` null while the note is unread. A key without a stored note yields no row.
- The query returns no content, only the key and the read timestamp. If several notes share a key, the oldest decides.
- Access is `SystemAdmin`. The query is tenant-scoped: it only sees notes of the tenant it runs in. A cross-tenant caller dispatches it per tenant as `createSystemUser(tenantId, ["SystemAdmin"])`, as the contact feature does for the reporter tenant.
- A deployment without `channel-in-app` simply lacks the query; callers check whether it is registered and treat every key as unread.

Existing rows have no key, so only notes sent after the migration (`kumiko schema generate`) are found.
