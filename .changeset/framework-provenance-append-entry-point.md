---
"@cosmicdrift/kumiko-framework": minor
---

Event-store gains `appendProvenanceEvent(db, event)` — a declared, framework-owned entry point for provenance events that must bypass cross-feature event ownership (fw#2914).

`appendProvenanceEvent` (`@cosmicdrift/kumiko-framework/event-store`) takes a plain `TenantDb` and an event (`aggregateId`, `aggregateType`, `tenantId`, `expectedVersion` — a number or `"current"` to resolve the stream's current version inside the same savepoint, `type`, `payload`, `metadata`), grants itself a raw runner with a fixed, framework-owned reason, runs the append in a driver savepoint when one is available, and calls the public `append()`. The reason string is never caller-supplied — only the framework declares why this append is allowed to skip the ownership check. A `TenantDb` not built by `createTenantDb` fails closed.

<!-- kumiko-changes
feature: framework
type: feature
title: Event-store gains appendProvenanceEvent(db, event), a declared entry point for provenance events (fw#2914).
migration: |
  No action required — purely additive. Existing self-granted `withUnsafeRawGrant(...).unsafeRaw(...)` provenance writers can migrate to `appendProvenanceEvent` in a follow-up; nothing is removed in this change.
-->
