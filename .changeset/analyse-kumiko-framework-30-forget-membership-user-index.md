---
"@cosmicdrift/kumiko-framework": patch
---

The event store gets an index for the membership lookup by user that the forget cleanup runs.

<!-- kumiko-changes
feature: event-store
type: improvement
title: Membership events indexed by payload userId
detail: `kumiko_events` gets the partial index `events_membership_payload_user_idx` over `payload->>'userId'` for `tenant-membership` events, created on boot like the other secondary event indexes. The forget cleanup reads a user's historical tenants through it instead of scanning the event table once per due user.
-->
