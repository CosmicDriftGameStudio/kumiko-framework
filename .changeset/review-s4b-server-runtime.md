---
"@cosmicdrift/kumiko-server-runtime": patch
---

Bootstrap fails when a global-role invite cannot be provisioned; delivery notify works without auth

<!-- kumiko-changes
feature: server-runtime
type: fix
title: Bootstrap fails when a global-role invite cannot be provisioned; delivery notify works without auth
detail: runBootstrap now fails with a non-zero exit when an invite with global roles ends role-mismatch or cancelled. The delivery notify factory gets a config resolver also when the app has no auth feature.
-->
