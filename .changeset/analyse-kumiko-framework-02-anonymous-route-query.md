---
"@cosmicdrift/kumiko-framework": patch
---

Anonymous extra routes can read through `deps.query` as the request session instead of misusing a write handler.

<!-- kumiko-changes
feature: framework
type: improvement
title: Anonymous extra routes get deps.query
detail: An `entry: "anonymous"` extra route now receives `deps.query(type, payload)`, which runs a query handler as the session the /api chain resolved for the request: anonymous without a token, the signed-in user with one, always on the request-resolved tenant. Like `deps.write`, it works only under "/api/" with `anonymousAccess` wired and throws otherwise. A route that only reads no longer needs a write handler.
-->
