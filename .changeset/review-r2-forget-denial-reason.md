---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
---

The `forget-denied` audit event now records the specific tenant-gate reason (for example `target_tenant_not_admin_tenant`) instead of the generic `access_denied`. The framework exports `requireEntityTableMeta` from `bun-db`.

<!-- kumiko-changes
feature: crypto-shredding
type: fix
title: forget-denied audit events record the specific tenant-gate denial reason
-->
