---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Write handlers can declare `additionalRateLimits: [{ per: { payloadField: "email" }, limit, windowSeconds }]` next to `rateLimit`. The named string field of the validated payload is trimmed, lowercased and HMAC-hashed (key derived from the server's current JWT signing secret) into the bucket key `payload+handler:<handler>:<field>:<digest>`, so one address is limited across all IPs and Redis never holds it in plaintext. The check runs after schema validation and before the handler, answers 429 `rate_limited`, behaves the same for matching and non-matching values, and is skipped for system callers. Rotating the JWT secret only resets these buckets.

Boot rejects `additionalRateLimits` on an anonymous handler without a real ip-keyed `rateLimit` (the payload bucket only complements the IP bucket), an empty list, a `payloadField` that is not a field of the Zod object schema, and a non-positive `limit` or `windowSeconds`. A handler with `additionalRateLimits` makes `buildServer` wire the rate-limit resolver. The option exists on write handlers only and appears in the feature-ast patterns, render and patch schema.

Behavior change: `request-contract-termination` and `signup-request` now allow 3 requests per email address per 24 hours, and each token-request endpoint (`request-password-reset`, `request-email-verification`, `request-account-unlock`) allows 5 per address per 24 hours, in addition to the existing per-IP limits. The public `/api/auth` token-request routes still answer `{ isSuccess: true }` when the limit is hit; only the mail is not sent.

<!-- kumiko-changes
feature: framework
type: improvement
title: Per-recipient rate limits on payload fields (additionalRateLimits)
-->
