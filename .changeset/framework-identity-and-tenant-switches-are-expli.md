---
"@cosmicdrift/kumiko-framework": minor
---

Identity and tenant switches are explicitly gated; escape-hatch audit is durable

<!-- kumiko-changes
feature: framework
type: breaking
title: Identity and tenant switches are explicitly gated; escape-hatch audit is durable
migration: |
  Job ctx.writeAs now needs r.systemScope() on the feature or escapeHatch: { reason } on the job; use ctx.write when the job acts as its own system user. A payload tenantIdOverride is refused by the dispatcher for non-SystemAdmin callers (handlers no longer call crossTenantOverrideDenied, which is removed; use mayOverrideTenant for other cross-tenant fields). Entity convention handlers with a cross-tenant escapeHatch now keep the operator as actor in the row stream (executor option streamTenantId, system-mode db only). createEscapeHatchReporter requires log; pass the runtime logger and share one report window per runtime. EscapeHatchUseEvent and the audit sink payload gain an optional caller. Call flushEscapeHatchAudits() before closing the database on shutdown.
-->
