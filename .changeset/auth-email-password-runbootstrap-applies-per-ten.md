---
"@cosmicdrift/kumiko-bundled-features": minor
---

runBootstrap applies per-tenant config

BootstrapTenant.config sets tenant-scope config keys as system writes on every run; a value that already matches is not rewritten.

<!-- kumiko-changes
feature: auth-email-password
type: improvement
title: runBootstrap applies per-tenant config
-->
