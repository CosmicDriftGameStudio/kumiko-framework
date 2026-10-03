---
"@cosmicdrift/kumiko-dispatcher-live": patch
---

Write and batch errors carry httpStatus from the response

dispatcher-live: write and batch failures now take `httpStatus` from the HTTP response when the server's error body omits it, like queries already did. `isSessionEndedError` now also triggers on a failed write after the session ended.

<!-- kumiko-changes
feature: dispatcher-live
type: fix
title: Write and batch errors carry httpStatus from the response
-->
