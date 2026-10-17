---
"@cosmicdrift/kumiko-framework": patch
---

Entity convention handlers: per-verb agent hints merge, foreign rows with a non-TenantId tenant fail loudly

<!-- kumiko-changes
feature: framework
type: fix
title: registerEntityCrud merges per-verb agent hints into write.agent and read.agent
detail: agents[verb] used to replace write.agent or read.agent wholesale, so write: { agent: { expose: true } } with agents: { delete: { risk: "high" } } dropped expose on delete. The two are now merged with the per-verb value winning. An escapeHatch update/delete/restore on a row whose tenantId is not a valid TenantId throws an InternalError instead of silently appending to the operator's own tenant stream.
-->
