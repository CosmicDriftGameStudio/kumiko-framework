---
"@cosmicdrift/kumiko-framework": patch
---

The echoed write event is now removed from the response at the dispatcher boundary instead of being hidden on the result object. A handler that copies the executor result with a spread (`{ ...created.data, extra }`) keeps the event, so projections and postSave hooks fire again for it.

<!-- kumiko-changes
feature: framework
type: fix
title: write handlers that spread the executor result keep projections and postSave hooks
detail: The event is stripped from lifecycle results when the dispatcher masks the response, no longer made non-enumerable on the result, so copying the result does not lose it. Responses still carry no event.
-->
