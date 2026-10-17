---
"@cosmicdrift/kumiko-framework": patch
---

bindReferencedFiles loads file refs in bulk and skips refs it must not bind

<!-- kumiko-changes
feature: framework
type: fix
title: bindReferencedFiles binds only refs of the record's tenant in one bulk load
detail: File refs for a page are loaded with a single query restricted to the writer's tenant and live rows; system-owned refs are not bound to records.
-->
