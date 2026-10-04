---
"@cosmicdrift/kumiko-bundled-features": minor
---

Audit queries accept `scope: "system"` for SystemAdmin

`audit:query:list` and `audit:query:details` take an optional `scope` (`"tenant"` or `"system"`). With `"system"` a SystemAdmin reads the app-instance system events, e.g. `kumiko:system:app.started`; other roles are denied. Without `scope` nothing changes.

<!-- kumiko-changes
feature: audit
type: improvement
title: Audit queries can read app-instance system events with scope "system" (SystemAdmin only)
-->
