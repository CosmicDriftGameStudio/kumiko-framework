---
"@cosmicdrift/kumiko-framework": patch
---

`/delivery-log` is now a declarative `projectionList` screen instead of a hand-rolled `custom` React component. `delivery:query:log` moved to `definePagedQueryHandler` (cursor/limit/sort, whitelisted sort columns, id tie-breaker) and now returns `type`/`recipient` display fields instead of the raw `notificationType`/`recipientAddress` column names — that mapping used to live in the client component. The status column keeps a small `DeliveryStatusCell` renderer (`StatusBadge`); the rest of the old 103-line screen component is gone.
