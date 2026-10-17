---
"@cosmicdrift/kumiko-framework": patch
---

restore no longer fails on entities with money fields

<!-- kumiko-changes
feature: framework
type: fix
title: Restoring a soft-deleted row with a money field no longer fails with a 500
detail: restore() wrote the raw stored row (money as bigint minor units) into payload.previous, and the jsonb bind threw. It now builds previous in the same domain form as delete(), so the restored event carries { amount, currency, ... } for money fields.
-->
