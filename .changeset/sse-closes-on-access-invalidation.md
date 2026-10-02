---
"@cosmicdrift/kumiko-framework": patch
---

SSE stream closes when access is revoked

The live event stream (GET /sse) now closes as soon as the session behind it is revoked or the user's tenant roles change or the membership is removed. User-addressed frames such as in-app notifications are delivered only to the addressed user instead of the whole tenant.

<!-- kumiko-changes
feature: framework
type: fix
title: SSE stream closes when access is revoked
-->
