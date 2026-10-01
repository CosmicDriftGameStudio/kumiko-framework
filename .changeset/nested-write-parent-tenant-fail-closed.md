---
"@cosmicdrift/kumiko-framework": patch
---

The nested-write parent tenant check now fails closed when the parent row has no `tenantId`.

<!-- kumiko-changes
feature: framework
type: fix
title: Nested-write parent tenant check fails closed for parent rows without tenantId
-->
