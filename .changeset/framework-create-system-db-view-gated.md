---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": patch
---

createUncheckedSystemDb is no longer exported from /db; use createSystemDbView, whose unsafeRaw follows the source TenantDb's escapeHatch gate (fw#3205)

<!-- kumiko-changes
feature: framework
type: breaking
title: createUncheckedSystemDb is no longer exported from /db; use createSystemDbView, whose unsafeRaw follows the source TenantDb's escapeHatch gate (fw#3205)
migration: |
  Import auf createSystemDbView umstellen; wer unsafeRaw auf einem selbstgebauten systemDb braucht, übergibt eine TenantDb mit unsafeRaw-Grant (createTenantDb(..., { unsafeRaw: { reason } })).
  Delivery: ein tenantUserIdsQuery-Handler ohne r.systemScope() bekommt jetzt wie im Dispatcher eine tenant-mode ctx.db und kein ctx.systemDb; Handler, die Cross-Tenant-Zugriff brauchen, deklarieren r.systemScope().
-->
