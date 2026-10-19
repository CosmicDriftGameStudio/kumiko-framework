---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
---

A handler can declare several rate-limit buckets

`rateLimit` accepts a list: `rateLimit: [{ per: "user", limit: 2, windowSeconds: 3600 }, { per: "tenant+handler", limit: 3, windowSeconds: 3600 }]`. Each bucket applies on its own, and the check is all-or-nothing: if one bucket is exhausted the call answers 429 for that bucket and none of them is charged. `additionalRateLimits` (payload buckets) gets the same all-or-nothing check.

All-or-nothing holds within one list. Handler `rateLimit` buckets are charged in the pre-handler gate, before schema validation; payload buckets (`additionalRateLimits`) need the validated payload. A later payload rejection therefore does not undo the handler charges.

`RateLimitResolver` has a new required method `enforceAll(requests)` that checks and deducts several buckets atomically (one Lua script in the Redis resolver). Boot fails for an empty list, for the same `per` twice, for the same `payloadField` twice in `additionalRateLimits`, and for anonymous handlers with a user-keyed bucket or tenantless-anonymous handlers with a non-ip bucket in the list. `@cosmicdrift/kumiko-types/handlers` exports `RateLimitOptions`, `declaredRateLimitOptions` and `isRateLimitOption`.

<!-- kumiko-changes
feature: framework
type: breaking
title: rateLimit accepts a list of buckets that are enforced all-or-nothing
detail: RateLimitDeclaration is now a single option, a non-empty list of options or the disabled form. RateLimitResolver gains the required method enforceAll(requests: readonly RateLimitBucketRequest[]); createRateLimitResolver and createUnlimitedRateLimitResolver implement it. Payload buckets in additionalRateLimits are charged through the same call.
migration: Custom RateLimitResolver implementations and test fakes need an enforceAll method (check every bucket, then deduct from all or none, and throw RateLimitError for the rejected bucket with the largest retryAfter). Existing rateLimit declarations stay valid. A duplicate payloadField in additionalRateLimits is now a boot error; merge the entries into one.
-->
