---
"@cosmicdrift/kumiko-bundled-features": patch
---

billing-foundation: `process-event` drops a non-`created` provider event that belongs to a different subscription than the one the tenant's row currently tracks, while that row still blocks checkout. A late webhook retry of a superseded subscription can no longer flip the live subscription to `canceled`. The webhook answers 200 with `stale: true`.

<!-- kumiko-changes
feature: billing-foundation
type: improvement
title: late events of a superseded provider subscription no longer overwrite the live row
migration: |
  No action needed: events of the tracked subscription and `created` events behave as before.
-->
