---
"@cosmicdrift/kumiko-framework": patch
---

Dispatch routes validate requestId and every batch command up front

<!-- kumiko-changes
feature: framework
type: fix
title: Malformed requestId or batch command shapes return 400 instead of failing later
detail: The dispatch and batch routes parse requestId and each command before dispatching, returning a validation error for malformed shapes, and the JSON body reader no longer relies on a type assertion.
-->
