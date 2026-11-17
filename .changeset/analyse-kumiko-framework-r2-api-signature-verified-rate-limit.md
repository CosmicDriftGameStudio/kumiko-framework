---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

Signature routes can limit calls per verified caller with `verifiedRateLimit`.

<!-- kumiko-changes
feature: framework
type: improvement
title: Rate limit keyed by the verified caller on signature routes
detail: A `signatureRoute` takes `verifiedRateLimit: { key, limit, windowSeconds, rejectionBody? }`. After `verify()` succeeds, buildServer checks the bucket of `key(verified)` (for example the app id or tenant the signature proved) through the shared Redis rate-limit store before the handler runs, so the limit holds across replicas and restarts. Each route and key has its own bucket. Over the limit the route answers 429 with `Retry-After` and `X-RateLimit-*` headers, with the framework's `rate_limited` error body or the body `rejectionBody(decision)` returns (for example a provider-specific error format). Like `rateLimit` it fails open on a Redis outage and is skipped without Redis, and declaring it is enough for buildServer to create the resolver. Boot rejects a limit or window that is not a positive integer. An app that keeps an in-memory request window per caller in a signature route can drop it.
-->
