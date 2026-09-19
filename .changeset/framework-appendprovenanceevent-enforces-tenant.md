---
"@cosmicdrift/kumiko-framework": minor
---

appendProvenanceEvent enforces event.tenantId === db.tenantId

`appendProvenanceEvent(db, event)` now rejects with `AccessDeniedError` when `event.tenantId` does not match the `tenantId` of the passed `TenantDb`, before anything is written. The check runs after `unsafeRawForDeclaredStep` (so a hand-built or non-`createTenantDb` holder still fails closed first) and is unconditional, including `mode: "system"` — `crossTenantRebinders` keeps the original `tenantId` and only flips the mode, so a system-scoped db cannot append provenance for a foreign tenant either. Cross-tenant provenance has no path through this entry point; a caller that needs it declares its own escapeHatch path instead (kumiko-framework#2947).

<!-- kumiko-changes
feature: framework
type: breaking
title: appendProvenanceEvent enforces event.tenantId === db.tenantId
-->
