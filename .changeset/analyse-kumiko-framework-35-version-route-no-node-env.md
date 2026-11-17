---
"@cosmicdrift/kumiko-framework": minor
---

`GET /version` no longer reports the server's NODE_ENV.

<!-- kumiko-changes
feature: framework
type: breaking
title: /version drops the node field
detail: The public `GET /version` route returns `{ version, buildTime }`. The `node` field that exposed `NODE_ENV` to anonymous callers is removed.
migration: Clients or monitors that read `node` from `/version` read the environment from their own deployment config instead.
-->
