---
"@cosmicdrift/kumiko-framework": patch
---

Projection rebuilds run each apply in the row-level-security scope of the event's tenant, as the live write path does.

<!-- kumiko-changes
feature: framework
type: fix
title: Rebuild applies use the event's tenant scope
detail: `rebuildProjection` ran every apply in the system scope it uses to read events of all tenants, while live applies run in the event's tenant scope. An apply that reads another table without its own tenant filter (a lookup or a counter) therefore saw rows of all tenants during a rebuild and could write values that differ from the live result. Each apply now runs inside `inEventStreamScope(event.tenantId)`; reading the log, the shadow table setup, the fence and the guards stay in system scope. Multi-stream projection rebuilds are unchanged because their live delivery also runs in system scope.
-->
