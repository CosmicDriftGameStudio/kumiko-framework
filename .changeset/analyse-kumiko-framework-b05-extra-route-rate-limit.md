---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

Extra routes accept a declarative `rateLimit`, enforced through the server's shared rate-limit store.

<!-- kumiko-changes
feature: framework
type: improvement
title: Extra routes declare their own rate limit
detail: Every `extraRoutes` entry (`anonymous`, `user`, `signature`) takes `rateLimit: { per: "ip" | "ip+handler", limit, windowSeconds }`, the same option `r.httpRoute` has. buildServer enforces it through the shared Redis resolver before the body limit, `verify()` and the handler, so the limit holds across replicas and restarts. Like the `r.httpRoute` limit it fails open on a Redis outage and is skipped when the server has no Redis, and declaring it is enough for buildServer to create the resolver. Apps that count requests per IP in an in-memory map on an extra route can drop that map. Boot rejects a limit or window that is not a positive integer.
-->
