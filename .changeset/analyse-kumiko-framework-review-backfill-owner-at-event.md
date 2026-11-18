---
"@cosmicdrift/kumiko-framework": patch
---

The PII backfill encrypts an update under the owner the stream had at that event, not under today's owner.

<!-- kumiko-changes
feature: framework
type: fix
title: PII backfill keys slim updates by the owner at that event
detail: Update events carry only the changed keys in previous, so an update that did not touch the owner names none. The backfill then took the owner from the projection row, which holds today's owner: after an owner change, values written under the earlier owner were keyed to the later one, stayed readable after the earlier owner was erased and became unreadable when the later one was. The backfill now folds the aggregate's stream up to each update (created plus the changes of every earlier lifecycle event) and resolves the owner from that state. The event format does not change.
-->
