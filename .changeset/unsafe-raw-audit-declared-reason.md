---
"@cosmicdrift/kumiko-framework": patch
---

`ctx.db.unsafeRaw(reason)` and `ctx.systemDb.unsafeRaw(reason)` now write the reason declared on the handler or hook `escapeHatch` into the escape-hatch audit event, not the string passed at the call. A call-site string can no longer put arbitrary text into the audit trail.

<!-- kumiko-changes
feature: framework
type: improvement
title: unsafeRaw audit events carry the declared escapeHatch reason
migration: |
  No action needed: calls that pass the same reason as the declaration audit unchanged. Calls with a different string now audit the declared reason.
-->
