---
"@cosmicdrift/kumiko-framework": patch
---

PII backfill: explicit null owner is not a missing owner, owner re-key covers user-keyed values

<!-- kumiko-changes
feature: framework
type: fix
title: PII backfill keeps ownerless events under the tenant key and re-keys values left under a previous owner
detail: With resolveOwnerFromProjection the projection owner is now used only when the event does not carry the owner key at all; an explicit null owner resolves through whenAbsent like the live write path. The owner re-key stage (rekeyTenantKeyedOwnerFields) also moves user-keyed values to the projection's current owner when that is another user, so after an owner change X to Y that predates re-keying on transition, forgetting Y erases the value. Known divergence: a row that went ownerless, then owned by X, then ownerless again keeps its created-event value under the tenant key, while the live path keeps it with X.
-->
