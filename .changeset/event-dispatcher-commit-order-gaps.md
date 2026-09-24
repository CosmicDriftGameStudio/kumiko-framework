---
"@cosmicdrift/kumiko-framework": patch
---

The event-dispatcher's cursor advanced to the highest `events.id` seen in a poll, but ids are assigned at INSERT time, not commit time — two concurrent writers could grab ids N and N+1 and commit out of order, and once the cursor passed N+1 it never revisited N once that transaction finally committed. The dispatcher now tracks ids below the cursor that were invisible on some earlier turn as pending gaps, retries them alongside the normal window, and only drops one once a later snapshot proves its writer has finished without ever committing.

<!-- kumiko-changes
feature: framework
type: fix
title: Event dispatcher no longer skips events that commit out of id order
-->
