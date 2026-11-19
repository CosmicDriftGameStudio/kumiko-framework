---
"@cosmicdrift/kumiko-framework": patch
---

The client IP resolver no longer trusts the X-Real-IP header.

<!-- kumiko-changes
feature: framework
type: fix
title: Short X-Forwarded-For chains fall back to the socket address
detail: With `trustedProxyHops` of 1 or more and an `X-Forwarded-For` chain shorter than the hop count, the resolver used `X-Real-IP` before the socket address. A client that reached the server past the proxy could pick its own rate-limit bucket that way, or fill someone else's. Such a request now resolves to the socket address, or to `unknown` without one. `X-Real-IP` is not read anymore.
-->
