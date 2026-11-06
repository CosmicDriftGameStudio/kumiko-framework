---
"@cosmicdrift/kumiko-bundled-features": patch
---

Starting a checkout is rate-limited per tenant.

<!-- kumiko-changes
feature: billing-foundation
type: fix
title: create-checkout-session and start-plan-checkout allow 30 starts per tenant and hour
detail: Every started checkout appends a `checkout-opened` event to the tenant's stream, which each webhook reads in full. Both checkout-starting handlers now declare `{ per: "tenant+handler", limit: 30, windowSeconds: 3600 }`, so a tenant member can no longer grow the stream without bound. An app that mounts billing-foundation now needs a rate limit resolver (Redis on `context.redis` or `context.rateLimit`); without one the handler fails at dispatch.
-->
