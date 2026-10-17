---
"@cosmicdrift/kumiko-dispatcher-live": patch
---

An unexpected JSON response shape keeps the HTTP status of the response

<!-- kumiko-changes
feature: dispatcher-live
type: fix
title: Responses that match no envelope report their real httpStatus instead of 0
detail: A 401 from a foreign middleware or a proxy 500 with a plain JSON body used to arrive as httpStatus 0, so logic that reacts to 401 or 5xx never fired. The error keeps the code network_error but now carries the response status.
-->
