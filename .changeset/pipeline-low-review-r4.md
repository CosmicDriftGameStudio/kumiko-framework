---
"@cosmicdrift/kumiko-framework": patch
---

The `public_intake_required` 403 no longer puts the physical table name and personal-data column names into `message` or `details` (it keeps `reason`, `rootHandler` and `job`); they travel in the error `cause` for the server log. The event dispatcher counts idle-gated consumer turns in the new `kumiko_event_consumer_pass_skipped_total{reason="idle"}` counter, since those turns open no `events.consumer.pass` span. Personal-data column sets for the anonymous write gate are cached per entity.

<!-- kumiko-changes
feature: framework
type: fix
title: public_intake_required 403 no longer discloses table and column names to anonymous callers
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: Idle-gated event consumer turns are counted in kumiko_event_consumer_pass_skipped_total
-->
