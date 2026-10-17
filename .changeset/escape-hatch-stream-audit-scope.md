---
"@cosmicdrift/kumiko-framework": patch
---

Escape-hatch audit scope now covers streams until they finish

<!-- kumiko-changes
feature: framework
type: fix
title: Escape-hatch audits are collected for the whole stream
detail: Dispatched streams run inside the escape-hatch audit scope for the full lifetime of the stream, and settled pending audits are dropped from the scope, so writes made while a stream is open are no longer missed.
-->
