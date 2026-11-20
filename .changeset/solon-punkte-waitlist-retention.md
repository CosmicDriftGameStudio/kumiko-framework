---
"@cosmicdrift/kumiko-bundled-features": patch
---

`createWaitlistFeature({ retention: { keepFor } })` deletes waitlist entries after a retention period.

<!-- kumiko-changes
feature: waitlist
type: improvement
title: Waitlist entries can expire automatically
detail: createWaitlistFeature takes the optional retention: { keepFor } (data-retention keepFor syntax, e.g. "180d"). The waitlist entry entity then declares a hardDelete retention counted from creation, so the data-retention cleanup job forgets every entry older than keepFor, whatever its status (pending, invited, provisioned, rejected), and shreds its subject key. The app must mount the data-retention feature. Without the option nothing changes. Also exported, WaitlistRetention.
-->
