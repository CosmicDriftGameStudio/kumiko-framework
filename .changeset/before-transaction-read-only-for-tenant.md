---
"@cosmicdrift/kumiko-framework": patch
---

ctx.forTenant is available read-only in the beforeTransaction phase

<!-- kumiko-changes
feature: framework
type: improvement
title: ctx.forTenant is available read-only in the beforeTransaction phase
detail: A beforeTransaction phase can now resolve ctx.forTenant(tenantId) for its own tenant and, as a SystemAdmin, for a foreign tenant, to read rows or build tenant-scoped inputs such as uploads. The returned db denies every write; a foreign tenant stays gated by the SystemAdmin check. reserveBeforeTransaction, perCommand and in-transaction handlers are unchanged.
-->
