---
"@cosmicdrift/kumiko-framework": minor
---

appendProvenanceEvent enforces event.tenantId === db.tenantId

`appendProvenanceEvent(db, event)` checked the event type namespace but wrote `event.tenantId` unverified while granting itself the framework-fixed unsafeRaw reason internally. Since `createLLMProviderForTenant(ctx, tenantId, …)` takes the tenantId as an argument, that made the entry point a cross-tenant write door with no escapeHatch declaration behind it.

The check now runs after `unsafeRawForDeclaredStep` — so a holder not built by `createTenantDb` still fails closed with `InternalError` first — and before the savepoint, so a rejected append leaves no row. It is unconditional, including `mode: "system"`: `crossTenantRebinders` keeps the original tenantId and only flips the mode, so a system-scoped db must not append provenance for a foreign tenant either.

`appendProvenanceEvent` deliberately keeps `withUnsafeRawGrant` + `unsafeRawForDeclaredStep` instead of resolving the runner through the ungated `tenantDbRunner`, because that grant path is the choke point the member-read lock in kumiko-framework#2927 hooks into.

<!-- kumiko-changes
feature: framework
type: breaking
title: appendProvenanceEvent enforces event.tenantId === db.tenantId
migration: |
  appendProvenanceEvent rejects with AccessDeniedError when event.tenantId does not match the tenantId of the passed TenantDb. Provenance for a foreign tenant has no path left through this entry point — a caller that needs it declares its own escapeHatch path instead. Blast radius checked: every known call site in kumiko-enterprise passes event.user.tenantId through, so no call site changes.
-->
