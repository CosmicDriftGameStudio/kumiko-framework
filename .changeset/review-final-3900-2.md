---
"@cosmicdrift/kumiko-framework": patch
---

`POST /api/client-errors` keeps a per-process rate limit when the shared limiter is configured. Before, a Redis outage made the fail-open shared limiter the only protection and an anonymous caller could flood the log pipeline; now the in-memory window of 10 reports per minute per IP always applies as a floor.

<!-- kumiko-changes
feature: framework
type: fix
title: client-errors route keeps an in-memory floor limit
detail: The in-memory per-IP limiter now runs in front of the Redis-backed limiter instead of only when no resolver is wired, so a failing resolver can no longer lift the limit on the public client-errors endpoint.
-->
