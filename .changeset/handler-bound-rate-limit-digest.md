---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Termination receipt limit no longer keys Redis by an unkeyed email hash

<!-- kumiko-changes
feature: billing-foundation
type: fix
title: The termination receipt rate limit keys Redis with a keyed, handler-bound digest instead of an unkeyed SHA-256 of the email
detail: HandlerContext gains an optional rateLimitDigest(value), an HMAC bound to the running handler, so a handler can build rate-limit keys without plaintext identifiers and cannot reproduce the dispatcher's payload-bucket digests. normalizePayloadBucketValue is exported from the pipeline entry point. The receipt limit reuses it, and withholds the receipt mail (the declaration is still recorded) when no digest is wired. Payload-bucket normalization now applies Unicode NFKC first, so fullwidth lookalikes share a bucket. Existing receipt buckets restart empty; they expire after the 24 hour window.
-->
