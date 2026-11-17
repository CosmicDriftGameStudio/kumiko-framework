---
"@cosmicdrift/kumiko-framework": patch
---

PII backfill and event payload scrub treat declared entity verbs like updated events.

<!-- kumiko-changes
feature: event-store
type: fix
title: Backfill and scrub reach declared verb events
detail: Events of a declared entity verb (<entity>.<verb>) carry { changes, previous } like updated. The PII backfill and the event payload scrub migration read them as flat payloads, so they missed the fields inside changes and previous. Both now treat a declared verb like a lifecycle event.
-->
