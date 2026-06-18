---
"@cosmicdrift/kumiko-framework": patch
---

Pending-rebuilds: scope the queue clear to the (table_name, migration_id) snapshot the run read, so a concurrent re-queue of the same table for a newer migration is no longer dropped between the read and the clear (#328). event-store list: document that list rows carry the read-row version (display-only, never an optimistic-lock base — edits reload via detail) so the #336 version_conflict can't creep back in.
