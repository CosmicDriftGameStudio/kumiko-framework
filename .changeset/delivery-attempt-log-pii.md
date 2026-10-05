---
"@cosmicdrift/kumiko-bundled-features": minor
---

The delivery attempt log keeps masked recipient addresses and prunes old attempts

New attempt events and log rows hold a masked address (`u***@example.com`, `https://hooks.example.com/***`, `***7890`) instead of the full one. Chat webhook channels (Slack, Discord, Teams) keep logging their connection name, which is not personal data; a custom channel opts in with `addressKind: "connection-name"`. A daily job prunes attempt events and log rows older than 90 days, and forgetting a user erases the address on that user's attempt rows with a `delivery:event:attempt-address-erased` event, which also survives projection rebuilds.

<!-- kumiko-changes
feature: delivery
type: breaking
title: Delivery attempt log stores masked recipient addresses; attempts older than 90 days are pruned
detail: The log query, the export and the stored events show masked addresses, and the feature registers the daily attempt-log-retention job.
migration: Read recipients from your own data, not from the attempt log, because it only shows masked addresses now. Set `attemptLogRetentionDays` on createDeliveryFeature to another number of days, or to `false` to keep the log, if 90 days does not fit. Schedule nothing extra, the feature registers the cron job itself. Existing full-address entries are removed by the retention job once they are older than the window, or erased when their user is forgotten.
-->

<!-- kumiko-changes
feature: delivery
type: improvement
title: Forgetting a user erases the recipient address of their delivery attempts in plaintext mode too, through an event that survives projection rebuilds
-->
