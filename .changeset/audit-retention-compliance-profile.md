---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

The audit job `escape-hatch-retention` now deletes `escapeHatchUse` events after the `auditLog.retention` of the tenant's compliance profile. A tenant override can only lengthen that period, never go below the base retention of the selected profile. Cross-tenant audits (with `targetTenantId`, e.g. `identity-switch`) additionally follow the profile of the target tenant. The config key `audit:config:escape-hatch-retention-days` is only the fallback when compliance-profiles is not mounted.

`pruneEvents` gains the optional `aggregateIds` option to restrict the prune to specific aggregates. `@cosmicdrift/kumiko-framework/compliance` exports `subtractRetentionSpec` and the `RetentionSpec` type for calendar-aware cutoffs (months and years).

<!-- kumiko-changes
feature: audit
type: improvement
title: escape-hatch retention follows the tenant compliance profile
-->
