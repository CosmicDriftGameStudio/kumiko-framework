---
"@cosmicdrift/kumiko-framework": patch
---

POST /auth/session-exchange gives its rate-limit slot back after a successful exchange, so legitimate logins behind one NAT IP no longer lock each other out while failed attempts stay counted.

<!-- kumiko-changes
feature: auth
type: fix
title: Successful session exchanges no longer exhaust the IP and method rate limit
detail: The route still counts before dispatching, so a parallel burst of failures cannot exceed the limit. After a successful exchange it now returns exactly its own reservation via the new optional `LoginRateLimiter.refund` (in-memory and Redis limiters implement it) instead of leaving it counted; no reset, so one success cannot reopen guessing slots taken by others. Custom limiters without `refund` keep the old behavior.
affects: auth, session-exchange, LoginRateLimiter
-->
