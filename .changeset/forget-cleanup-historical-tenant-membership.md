---
"@cosmicdrift/kumiko-bundled-features": patch
---

`run-forget-cleanup`'s tenant-occupancy check (used to decide whether a tenant-scoped, no-per-user-column contributor is safe to hard-delete on a GDPR forget request) counted only LIVE `tenant-membership` rows. `removeMember` deletes just the membership projection row — the underlying event history survives — so a tenant that once had two members and lost one down to a sole remaining member was misclassified as "single-user", and the remaining member's own forget request could wipe the departed co-member's leftover tenant-scoped data. The resolver now falls back to the event history (distinct `tenant-membership.created` `userId`s) whenever the live count is exactly 1, and treats any tenant that ever had more than one member as "multi-user" permanently — history can only push single-user → multi-user, never back.
