---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Payload rate limits can normalize emails and auth requests use a 15-minute window

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: Email payload buckets ignore plus-tags and case; auth requests are capped at 3 per 15 minutes
detail: additionalRateLimits accepts normalize: email, which lowercases and strips the plus-tag before hashing, and bucket keys are scoped by tenant and handler. Signup and token requests (reset, unlock, verification) and the waitlist default use it with a 3-request, 900-second window.
-->
