---
"@cosmicdrift/kumiko-framework": patch
---

POST /auth/session-exchange gives its rate-limit slot back after a successful exchange, so legitimate logins behind one NAT IP no longer lock each other out while failed attempts stay counted. The refund is bound to the window the slot was counted in.

<!-- kumiko-changes
feature: framework
type: fix
title: Successful session exchanges no longer exhaust the IP and method rate limit
detail: The route still counts before dispatching, so a parallel burst of failures cannot exceed the limit. After a successful exchange it returns exactly its own reservation: the new optional `LoginRateLimiter.reserve(key)` counts like `check` and names the window (`{ allowed, window }`), and `refund(key, window)` gives the slot back only while that window is still the key's current one, so a slot of an expired window cannot shrink the counter of the next one. The in-memory and Redis limiters implement both (Redis keeps a window id in a companion `:w` key). No reset, so one success cannot reopen guessing slots taken by others. A failing refund is logged and leaves the slot counted; the exchange still succeeds. Custom limiters without `reserve`/`refund` keep the old behavior.
-->
