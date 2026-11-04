---
"@cosmicdrift/kumiko-bundled-features": minor
---

Jobs can list the members who opted in to a notification, and a job's system user can read in-app read state.

<!-- kumiko-changes
feature: delivery
type: improvement
title: New job-only query opted-in-user-ids
detail: The new query `delivery:query:opted-in-user-ids` (`{ notificationType, channel }`, answers `{ userIds }`) is open to system users only and lists, sorted and unique, the users of the caller's tenant whose preference row for exactly that notification type and channel is enabled. A job that sends an opt-in notification such as a daily digest uses it to address only the members who ordered it. Rows stored under a former name (`renamedFrom`) count under the current name; an exact row wins over a former-name row, as in `delivery:query:preferences`, and "*" wildcard rows never count as opt-in.
-->

<!-- kumiko-changes
feature: channel-in-app
type: improvement
title: readStateByKeys is readable by a job's system user
detail: `channel-in-app:query:readStateByKeys` now accepts the `system` role besides SystemAdmin, so a job running as the system user of a tenant reads the read state of its own tenant's messages directly. It still sees only keys of the caller's tenant.
-->
