---
"@cosmicdrift/kumiko-framework": patch
---

Boot validation rejects `entry: "signature"` extra routes whose pattern, including `:param` segments, matches a framework path such as `/api/write`. Such a route skipped the JWT, origin and CSRF guards for that path.

<!-- kumiko-changes
feature: framework
type: breaking
title: signature routes with a :param segment or wildcard must not match framework paths
migration: |
  Give the route a static prefix, for example `/api/webhooks/:provider` instead of `/api/:provider` or `/:provider/write`.
-->
