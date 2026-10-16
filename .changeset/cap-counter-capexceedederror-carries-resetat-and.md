---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

CapExceededError carries resetAt and retryAfterSeconds, API sets Retry-After

<!-- kumiko-changes
feature: cap-counter
type: breaking
title: CapExceededError carries resetAt and retryAfterSeconds, API sets Retry-After
migration: |
  Periodic caps no longer need RateLimitError({ windowSeconds: 0, ... }). Where you catch CapExceededError from enforceCap and rethrow it as RateLimitError, drop the catch and let CapExceededError pass: the response stays 429 with a correct Retry-After, error.code becomes cap_exceeded instead of rate_limited, and error.details carries resetAt and retryAfterSeconds. Keep a feature-specific message with enforceCap({ ..., i18nKey }) and pass a period end other than the calendar month with periodEndIso (e.g. a budget's resetsAtIso). Clients matching on rate_limited for these caps must also accept cap_exceeded. Any KumikoError with retryAfterSeconds (including RateLimitError thrown in a handler) now gets a Retry-After header from /api/write, /api/batch and /api/query.
-->
