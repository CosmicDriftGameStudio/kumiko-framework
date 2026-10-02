---
"@cosmicdrift/kumiko-framework": patch
---

Several fail-loud fixes. `buildServer` now also rejects more than one `principalStatus` provider when `auth.membershipQuery` is registered (previously every login 500ed at runtime). `updateMany` throws again on a key that is not a column, and the replay of historical update events skips fields removed from the entity instead. `lt`/`gt`/`lte`/`gte`/`like` on a jsonb column match nothing in the where builder, like the event-store read path.

<!-- kumiko-changes
feature: framework
type: fix
title: Boot rejects multiple principalStatus providers, updateMany rejects unknown columns again
-->
