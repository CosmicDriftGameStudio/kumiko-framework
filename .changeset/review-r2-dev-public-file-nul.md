---
"@cosmicdrift/kumiko-dev-server": patch
---

The dev-server public-file fallback answers a request path containing an encoded NUL byte (`%00`) or an over-long file name with the normal 404 instead of a 500. The scaffold deploy step now names `appName` as the cause when it is too long to serve as the default DB user.

<!-- kumiko-changes
feature: dev-server
type: fix
title: Dev public-file fallback returns 404 for NUL or over-long paths, deploy scaffold blames appName for an invalid default DB user
-->
