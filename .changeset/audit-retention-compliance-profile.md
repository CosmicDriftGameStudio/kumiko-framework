---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

The audit job `escape-hatch-retention` now deletes `escapeHatchUse` events per tenant after the `auditLog.retention` of that tenant's compliance profile (including per-tenant overrides). The config key `audit:config:escape-hatch-retention-days` is only the fallback when compliance-profiles is not mounted.

`pruneEvents` gains the optional `tenantIds` option to restrict the prune to specific tenants. `@cosmicdrift/kumiko-framework/compliance` exports `subtractRetentionSpec` and the `RetentionSpec` type for calendar-aware cutoffs (months and years).

<!-- kumiko-changes
feature: audit
type: improvement
title: escape-hatch retention follows the tenant compliance profile
-->
